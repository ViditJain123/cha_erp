import { ReauthRequiredError } from './oauth.js';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

export interface GraphError {
  error?: { code?: string; message?: string };
}

/** Graph's 410 for a delta cursor that has aged out. */
export class DeltaExpiredError extends Error {
  constructor() {
    super('The delta cursor is no longer valid and must be re-primed.');
    this.name = 'DeltaExpiredError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A single Graph call with the retry behaviour Microsoft asks for: honour
 * Retry-After on 429/503, and give up after a few attempts rather than
 * hammering a throttled mailbox.
 */
export async function graphFetch(
  accessToken: string,
  urlOrPath: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<Response> {
  const url = urlOrPath.startsWith('http') ? urlOrPath : `${GRAPH_ROOT}${urlOrPath}`;

  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${accessToken}`,
    },
  });

  if ((response.status === 429 || response.status === 503) && attempt < 3) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    // Fall back to exponential backoff when Graph gives no hint.
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
    return graphFetch(accessToken, urlOrPath, init, attempt + 1);
  }

  if (response.status === 401) {
    throw new ReauthRequiredError('Microsoft rejected the access token.');
  }

  if (response.status === 410) throw new DeltaExpiredError();

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as GraphError;
    throw new Error(
      `Graph ${init.method ?? 'GET'} ${url} failed (${response.status}): ${
        body.error?.message ?? response.statusText
      }`,
    );
  }

  return response;
}

export async function graphJson<T>(
  accessToken: string,
  urlOrPath: string,
  init?: RequestInit,
): Promise<T> {
  const response = await graphFetch(accessToken, urlOrPath, init);
  return (await response.json()) as T;
}

export interface GraphIdentity {
  id: string;
  mail: string | null;
  userPrincipalName: string;
  displayName: string | null;
}

/** The signed-in user, used to key the connection to an immutable account id. */
export async function fetchIdentity(accessToken: string): Promise<GraphIdentity> {
  return graphJson<GraphIdentity>(
    accessToken,
    '/me?$select=id,mail,userPrincipalName,displayName',
  );
}
