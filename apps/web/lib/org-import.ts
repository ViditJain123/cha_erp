import 'server-only';
import { createHash } from 'node:crypto';
import { parseOrganizationRepository } from '@/lib/org-repository';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Applying an Organization Repository snapshot.
 *
 * This is the whole of the import except who is allowed to run it and where
 * the bytes came from, so the route and a one-off script are the same code.
 * That matters here: the repair for what the old version did is itself an
 * import, and it has to be the fixed one.
 *
 * A Logi-Sys export is a full snapshot, so it is applied as one: every row in
 * the file is upserted, and every row that was here before and is not in the
 * file is deactivated. Nothing is deleted — a job filed last month still has to
 * resolve the party it was filed against.
 *
 * Two runs must not be able to eat each other. The sweep used to read
 * "deactivate everything not stamped with my import id", which is right for one
 * import and destructive for two: on 24 August 2026 the same file went up three
 * times in ten seconds and the runs retired each other's freshly stamped rows,
 * leaving 3,000 of 5,091 parties inactive and every importer in the corpus
 * unbound. So the sweep scopes by time — it retires only what it did not itself
 * touch — and a second import is refused while one is in flight.
 */

/** Rows per upsert. Large enough to be few round trips, small enough to send. */
const CHUNK = 1000;

/** How long an import may be in flight before it is presumed dead. */
const STALE_AFTER_MS = 15 * 60_000;

export interface OrganizationImportResult {
  importId: string;
  rowCount: number;
  inserted: number;
  updated: number;
  retired: number;
  warnings: string[];
}

export interface OrganizationImportFailure {
  error: string;
  status: number;
}

export type OrganizationImportOutcome = OrganizationImportResult | OrganizationImportFailure;

export function importFailed(
  outcome: OrganizationImportOutcome,
): outcome is OrganizationImportFailure {
  return 'error' in outcome;
}

/**
 * Reap an import whose process died mid-flight.
 *
 * Without this a crash leaves `status = 'running'` forever and every later
 * upload is refused. Fifteen minutes is well past the route's own 300-second
 * budget, so nothing live is ever reaped.
 */
async function reapStaleImports(companyId: string): Promise<void> {
  const db = serviceClient();
  await db
    .from('organization_imports')
    .update({ status: 'failed', error: 'Abandoned: the import did not finish.' })
    .eq('company_id', companyId)
    .eq('status', 'running')
    .lt('created_at', new Date(Date.now() - STALE_AFTER_MS).toISOString());
}

export async function applyOrganizationImport(input: {
  companyId: string;
  userId: string | null;
  fileName: string;
  data: Buffer;
}): Promise<OrganizationImportOutcome> {
  const { rows, warnings, errors } = await parseOrganizationRepository(input.data);
  if (errors.length > 0) return { error: errors.join(' '), status: 400 };

  const db = serviceClient();
  const sha256 = createHash('sha256').update(input.data).digest('hex');

  await reapStaleImports(input.companyId);

  // One import per company at a time. Without this a second press of the button
  // races the first and the two retire sweeps deactivate each other's rows.
  // `organization_imports_one_running` is the real guard; this is the readable
  // error in front of it.
  const { data: inFlight } = await db
    .from('organization_imports')
    .select('file_name, created_at')
    .eq('company_id', input.companyId)
    .eq('status', 'running')
    .maybeSingle();

  if (inFlight) {
    return {
      error:
        `${inFlight.file_name} is still loading, started ${inFlight.created_at}. ` +
        'Wait for it to finish before uploading again.',
      status: 409,
    };
  }

  const { data: importRow, error: importError } = await db
    .from('organization_imports')
    .insert({
      company_id: input.companyId,
      file_name: input.fileName,
      sha256,
      row_count: rows.length,
      warnings,
      imported_by: input.userId,
      status: 'running',
    })
    .select('id, created_at')
    .single();

  if (importError || !importRow) {
    // A unique violation here is the partial index catching a race the select
    // above was too early to see. Same answer either way.
    return {
      error: `Could not record the import: ${importError?.message ?? 'unknown error'}`,
      status: importError?.code === '23505' ? 409 : 500,
    };
  }

  /** Records why an import stopped, so a half-applied snapshot is not silent. */
  const fail = async (error: string, status: number): Promise<OrganizationImportFailure> => {
    await db
      .from('organization_imports')
      .update({ status: 'failed', error })
      .eq('id', importRow.id)
      .eq('company_id', input.companyId);
    return { error, status };
  };

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((row) => ({
      ...row,
      company_id: input.companyId,
      last_import_id: importRow.id,
    }));
    const { error } = await db
      .from('organizations')
      .upsert(chunk, { onConflict: 'company_id,name,branch_name,branch_sr_no' });
    if (error) {
      return fail(`Loaded ${i} of ${rows.length} organizations, then stopped: ${error.message}`, 500);
    }
  }

  // Anything the file did not mention is gone from Logi-Sys. Deactivated, not
  // deleted: an old job's party still has to resolve.
  //
  // Scoped by time, not by import id. `organizations_touch_updated_at` stamps
  // every row this upsert touched, and the import row was written before the
  // first chunk went up, so "updated_at older than this import started" is
  // exactly "the file did not mention it". A concurrent run then converges
  // rather than colliding: whatever it retires, the other run's upsert brings
  // back, because is_active is read from the file.
  const { data: retired, error: retireError } = await db
    .from('organizations')
    .update({ is_active: false })
    .eq('company_id', input.companyId)
    .eq('is_active', true)
    .lt('updated_at', importRow.created_at)
    .select('id');

  if (retireError) {
    return fail(`Loaded the file but could not retire the old rows: ${retireError.message}`, 500);
  }

  // Counted, not inferred. This used to be a before/after row count, which
  // reads as nonsense the moment anything else is writing to the table.
  const { count: insertedCount } = await db
    .from('organizations')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', input.companyId)
    .eq('last_import_id', importRow.id)
    .gte('created_at', importRow.created_at);

  const inserted = insertedCount ?? 0;
  const result: OrganizationImportResult = {
    importId: importRow.id,
    rowCount: rows.length,
    inserted,
    updated: Math.max(0, rows.length - inserted),
    retired: retired?.length ?? 0,
    warnings,
  };

  await db
    .from('organization_imports')
    .update({
      inserted_count: result.inserted,
      updated_count: result.updated,
      retired_count: result.retired,
      status: 'done',
    })
    .eq('id', importRow.id)
    .eq('company_id', input.companyId);

  return result;
}
