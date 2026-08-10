import { createHash, randomBytes } from 'node:crypto';
import { graphEnv } from '@checklist/config/env';

/** Delegated scopes. `offline_access` is what earns us a refresh token. */
export const GRAPH_SCOPES = ['offline_access', 'Mail.Read', 'Mail.Send', 'User.Read'] as const;

/**
 * Scopes a connection must hold to be fully usable. A mailbox connected before
 * Mail.Send was requested keeps working for reading but cannot send, so the UI
 * has to say so rather than failing at the moment someone clicks send.
 */
export function missingScopes(granted: readonly string[]): string[] {
  // Microsoft echoes scopes back inconsistently: sometimes the short name
  // (`Mail.Read`), sometimes the full resource URI
  // (`https://graph.microsoft.com/Mail.Read`), and with varying case. Comparing
  // literally would report a scope as missing right after it was granted, and
  // the user would be told to reconnect a mailbox they had just reconnected.
  const shortName = (scope: string) => (scope.split('/').pop() ?? scope).toLowerCase();
  const held = new Set(granted.map(shortName));

  return GRAPH_SCOPES.filter(
    // offline_access is a grant modifier, not a resource scope, and is not
    // always echoed back at all.
    (scope) => scope !== 'offline_access' && !held.has(shortName(scope)),
  );
}

export interface PkcePair {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

function authority(): string {
  return `https://login.microsoftonline.com/${graphEnv().MS_TENANT_ID}/oauth2/v2.0`;
}

export function createPkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    state: randomBytes(32).toString('base64url'),
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

export function authorizeUrl(pkce: PkcePair): string {
  const env = graphEnv();
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: env.MS_REDIRECT_URI,
    response_mode: 'query',
    scope: GRAPH_SCOPES.join(' '),
    state: pkce.state,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    // Always let the user pick which mailbox they are connecting; silently
    // reusing the browser's current Microsoft session connects the wrong one.
    prompt: 'select_account',
  });
  return `${authority()}/authorize?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  /** Absent only if Microsoft declines to rotate; callers must handle that. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}

/** Raised when Microsoft rejects the grant outright — the user must reconnect. */
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReauthRequiredError';
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(body: URLSearchParams): Promise<TokenSet> {
  const env = graphEnv();
  body.set('client_id', env.MS_CLIENT_ID);
  body.set('client_secret', env.MS_CLIENT_SECRET);

  const response = await fetch(`${authority()}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await response.json()) as TokenResponse;

  if (!response.ok || !json.access_token) {
    const detail = json.error_description?.split('\r')[0] ?? json.error ?? 'unknown error';
    // invalid_grant means the refresh token is dead — expired past the 90-day
    // inactivity window, revoked, or the password changed. No amount of
    // retrying fixes it; only the user reconnecting does.
    if (json.error === 'invalid_grant') throw new ReauthRequiredError(detail);
    throw new Error(`Microsoft token request failed: ${detail}`);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    // 60s of headroom so a token cannot expire mid-request.
    expiresAt: new Date(Date.now() + ((json.expires_in ?? 3600) - 60) * 1000),
    scopes: json.scope?.split(' ') ?? [],
  };
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: graphEnv().MS_REDIRECT_URI,
      code_verifier: codeVerifier,
      scope: GRAPH_SCOPES.join(' '),
    }),
  );
}

export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: GRAPH_SCOPES.join(' '),
    }),
  );
}
