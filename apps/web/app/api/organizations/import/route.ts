import { NextResponse } from 'next/server';
import { requireCompanyManager } from '@/lib/auth';
import { applyOrganizationImport, importFailed } from '@/lib/org-import';
import { MAX_UPLOAD_BYTES, sniffMime } from '@/lib/upload';

export const runtime = 'nodejs';
// Five thousand rows go up in chunks, and the file is read into memory before
// any of them do. Nowhere near the default ceiling, but not instant either.
export const maxDuration = 300;

/**
 * Loads the Organization Repository export out of Logi-Sys.
 *
 * Who may upload, and that the bytes really are an xlsx. The snapshot itself is
 * applied by `applyOrganizationImport`, so a script can run the same code — see
 * the note there about the three concurrent imports that retired 3,000 parties.
 */
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

  const outcome = await applyOrganizationImport({
    companyId: ctx.companyId,
    userId: ctx.userId,
    fileName: file.name,
    data,
  });

  if (importFailed(outcome)) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  const { importId: _importId, ...result } = outcome;
  return NextResponse.json(result);
}
