import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Opens a stored document.
 *
 * Signed URLs bypass RLS by design, so the caller's company is re-checked here
 * before one is minted — the signature is the last line of defence, not the
 * first.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  const ctx = await requireCompany();
  const { id, documentId } = await params;
  const db = serviceClient();

  const { data: document } = await db
    .from('job_documents')
    .select('storage_bucket, storage_path, file_name')
    .eq('id', documentId)
    .eq('job_id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!document) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { data: signed, error } = await db.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, 300);
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'Could not open that file.' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
