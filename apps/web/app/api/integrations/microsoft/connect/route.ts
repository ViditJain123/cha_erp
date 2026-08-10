import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authorizeUrl, createPkcePair } from '@checklist/graph';
import { isGraphConfigured, publicEnv } from '@checklist/config/env';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { OAUTH_STATE_COOKIE } from '@/lib/oauth';

export const runtime = 'nodejs';

/**
 * Starts the Microsoft consent flow.
 *
 * The PKCE verifier lives in a single-use database row rather than the session:
 * the callback arrives as a cross-site top-level redirect, and a server-side
 * row also gives an audit trail of who started which connection. A Lax cookie
 * carrying the state travels alongside as a second factor, so a leaked state
 * value alone cannot be replayed.
 */
export async function GET() {
  const ctx = await requireCompany();
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  if (!isGraphConfigured()) {
    return NextResponse.redirect(new URL('/settings/mailbox?error=not_configured', appUrl));
  }
  if (ctx.team !== 'scrutiny') {
    return NextResponse.redirect(new URL('/settings/mailbox?error=wrong_team', appUrl));
  }

  const pkce = createPkcePair();

  const { error } = await serviceClient().from('oauth_states').insert({
    state: pkce.state,
    company_id: ctx.companyId,
    profile_id: ctx.userId,
    code_verifier: pkce.codeVerifier,
  });
  if (error) {
    return NextResponse.redirect(new URL('/settings/mailbox?error=state_failed', appUrl));
  }

  const response = NextResponse.redirect(authorizeUrl(pkce));
  response.cookies.set(OAUTH_STATE_COOKIE, pkce.state, {
    httpOnly: true,
    sameSite: 'lax', // must survive the top-level GET redirect back from Microsoft
    secure: appUrl.startsWith('https://'),
    path: '/',
    maxAge: 600,
  });
  return response;
}
