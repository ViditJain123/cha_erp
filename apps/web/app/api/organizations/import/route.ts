import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireCompanyManager } from '@/lib/auth';
import { parseOrganizationRepository } from '@/lib/org-repository';
import { serviceClient } from '@/lib/supabase/admin';
import { MAX_UPLOAD_BYTES, sniffMime } from '@/lib/upload';

export const runtime = 'nodejs';
// Five thousand rows go up in chunks, and the file is read into memory before
// any of them do. Nowhere near the default ceiling, but not instant either.
export const maxDuration = 300;

/**
 * Loads the Organization Repository export out of Logi-Sys.
 *
 * A Logi-Sys export is a full snapshot, so this is applied as one: every row
 * in the file is upserted, and every row that was here before and is not in
 * the file is deactivated. Nothing is deleted — a job filed last month still
 * has to resolve the party it was filed against.
 */

/** Rows per upsert. Large enough to be few round trips, small enough to send. */
const CHUNK = 1000;

export async function POST(request: Request) {
  const ctx = await requireCompanyManager();

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose the exported .xlsx file.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `${file.name} is larger than 25 MB.` }, { status: 400 });
  }

  const data = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffMime(data, file.name);
  if (mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return NextResponse.json(
      {
        error:
          'That is not an .xlsx file. In Logi-Sys, open the Organization Repository and export it as XLSX.',
      },
      { status: 400 },
    );
  }

  const { rows, warnings, errors } = await parseOrganizationRepository(data);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  const db = serviceClient();
  const sha256 = createHash('sha256').update(data).digest('hex');

  // How many of these rows the company already had, so the result can say what
  // arrived and what merely changed. Counted before the upsert, because after
  // it every row belongs to this import.
  const { count: existingCount } = await db
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', ctx.companyId);

  const { data: importRow, error: importError } = await db
    .from('organization_imports')
    .insert({
      company_id: ctx.companyId,
      file_name: file.name,
      sha256,
      row_count: rows.length,
      warnings,
      imported_by: ctx.userId,
    })
    .select('id')
    .single();

  if (importError || !importRow) {
    return NextResponse.json(
      { error: `Could not record the import: ${importError?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => ({
      ...row,
      company_id: ctx.companyId,
      last_import_id: importRow.id,
    }));
    const { error } = await db
      .from('organizations')
      .upsert(chunk, { onConflict: 'company_id,name,branch_name,branch_sr_no' });
    if (error) {
      return NextResponse.json(
        {
          error: `Loaded ${i} of ${rows.length} organizations, then stopped: ${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  // Anything the file did not mention is gone from Logi-Sys. Deactivated, not
  // deleted: an old job's party still has to resolve.
  const { data: retired, error: retireError } = await db
    .from('organizations')
    .update({ is_active: false })
    .eq('company_id', ctx.companyId)
    .eq('is_active', true)
    .or(`last_import_id.is.null,last_import_id.neq.${importRow.id}`)
    .select('id');

  if (retireError) {
    return NextResponse.json(
      { error: `Loaded the file but could not retire the old rows: ${retireError.message}` },
      { status: 500 },
    );
  }

  const before = existingCount ?? 0;
  const { count: afterCount } = await db
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', ctx.companyId);

  const inserted = Math.max(0, (afterCount ?? before) - before);
  const result = {
    rowCount: rows.length,
    inserted,
    updated: rows.length - inserted,
    retired: retired?.length ?? 0,
    warnings,
  };

  await db
    .from('organization_imports')
    .update({
      inserted_count: result.inserted,
      updated_count: result.updated,
      retired_count: result.retired,
    })
    .eq('id', importRow.id)
    .eq('company_id', ctx.companyId);

  return NextResponse.json(result);
}
