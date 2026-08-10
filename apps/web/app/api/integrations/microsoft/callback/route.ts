import { NextResponse, type NextRequest } from 'next/server';
import {
  encryptTokenSet,
  exchangeCode,
  fetchIdentity,
  primeDelta,
  GRAPH_SCOPES,
} from '@checklist/graph';
import { publicEnv } from '@checklist/config/env';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { OAUTH_STATE_COOKIE } from '@/lib/oauth';

export const runtime = 'nodejs';
export const maxDuration = 60;

function back(reason: string): NextResponse {
  const url = new URL('/settings/mailbox', publicEnv().NEXT_PUBLIC_APP_URL);
  if (reason !== 'connected') url.searchParams.set('error', reason);
  else url.searchParams.set('connected', '1');
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const ctx = await requireCompany();
  const params = request.nextUrl.searchParams;

  // The user declined consent, or Entra refused outright.
  if (params.get('error')) return back(params.get('error') ?? 'consent_declined');

  const state = params.get('state');
  const code = params.get('code');
  if (!state || !code) return back('missing_code');

  // Both factors must agree: the cookie proves this browser started the flow,
  // the row proves the state was issued by us and has not been used already.
  if (request.cookies.get(OAUTH_STATE_COOKIE)?.value !== state) return back('state_mismatch');

  const db = serviceClient();
  const { data: stateRow } = await db
    .from('oauth_states')
    .select('*')
    .eq('state', state)
    .maybeSingle();

  // Single use, whatever happens next.
  await db.from('oauth_states').delete().eq('state', state);

  if (!stateRow) return back('state_unknown');
  if (new Date(stateRow.expires_at).getTime() < Date.now()) return back('state_expired');
  if (stateRow.profile_id !== ctx.userId || stateRow.company_id !== ctx.companyId) {
    return back('state_mismatch');
  }

  try {
    const tokens = await exchangeCode(code, stateRow.code_verifier);
    const identity = await fetchIdentity(tokens.accessToken);
    const emailAddress = identity.mail ?? identity.userPrincipalName;

    // Reuse the existing row when this mailbox was connected before, so
    // reconnecting after a revoked token keeps the delta cursor and history.
    const { data: existing } = await db
      .from('mail_connections')
      .select('id')
      .eq('provider', 'microsoft')
      .eq('provider_account_id', identity.id)
      .maybeSingle();

    const connectionId = existing?.id ?? crypto.randomUUID();

    // Establish the cursor before saving, so a mailbox is never left connected
    // with a null delta_link — the worker would then read its entire history.
    const deltaLink = await primeDelta(tokens.accessToken);

    const { error } = await db.from('mail_connections').upsert(
      {
        id: connectionId,
        company_id: ctx.companyId,
        profile_id: ctx.userId,
        provider: 'microsoft',
        provider_account_id: identity.id,
        email_address: emailAddress,
        display_name: identity.displayName,
        scopes: [...GRAPH_SCOPES],
        ...encryptTokenSet(connectionId, tokens),
        delta_link: deltaLink,
        delta_updated_at: new Date().toISOString(),
        status: 'active',
        consecutive_failures: 0,
        last_error: null,
        next_poll_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      },
      { onConflict: 'id' },
    );
    if (error) return back('save_failed');

    return back('connected');
  } catch (err) {
    console.error('[microsoft callback]', err);
    return back('exchange_failed');
  }
}
