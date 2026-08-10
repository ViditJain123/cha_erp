import { NextResponse } from 'next/server';
import { publicEnv } from '@checklist/config/env';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * Disconnects a mailbox. Tokens are cleared immediately; the connection row and
 * its processed-message history stay so previously ingested jobs keep their
 * provenance.
 */
export async function POST(request: Request) {
  const ctx = await requireCompany();
  const form = await request.formData();
  const connectionId = String(form.get('connectionId') ?? '');

  const { error } = await serviceClient()
    .from('mail_connections')
    .update({
      status: 'disabled',
      access_token_enc: null,
      refresh_token_enc: null,
      token_expires_at: null,
      locked_at: null,
      locked_by: null,
    })
    .eq('id', connectionId)
    // The service role bypasses RLS, so scope the tenant by hand.
    .eq('company_id', ctx.companyId);

  const url = new URL('/settings/mailbox', publicEnv().NEXT_PUBLIC_APP_URL);
  if (error) url.searchParams.set('error', 'disconnect_failed');
  return NextResponse.redirect(url, { status: 303 });
}
