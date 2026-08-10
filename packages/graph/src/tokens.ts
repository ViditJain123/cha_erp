import { decryptToken, encryptToken } from './crypto.js';
import { refreshAccessToken, type TokenSet } from './oauth.js';

/** The subset of a mail_connections row this module needs. */
export interface ConnectionTokens {
  id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
}

export interface PersistedTokens {
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
}

/** Encrypts a token set for storage against a specific connection. */
export function encryptTokenSet(
  connectionId: string,
  tokens: TokenSet,
  previousRefreshToken?: string,
): PersistedTokens {
  const refresh = tokens.refreshToken ?? previousRefreshToken;
  if (!refresh) {
    throw new Error('Microsoft returned no refresh token; the connection would not survive.');
  }
  return {
    access_token_enc: encryptToken(tokens.accessToken, connectionId),
    refresh_token_enc: encryptToken(refresh, connectionId),
    token_expires_at: tokens.expiresAt.toISOString(),
  };
}

/**
 * Returns a usable access token, refreshing if it is close to expiry.
 *
 * `persist` is called with the new ciphertexts whenever a refresh happens, and
 * must write them before the caller uses the token. Microsoft rotates the
 * refresh token on every exchange for confidential clients: storing only the
 * new access token leaves the old refresh token in the database, and the
 * connection dies about an hour later with `invalid_grant` for no visible
 * reason. This is the single most common way a Graph integration rots.
 *
 * Callers must hold the connection's claim lock — two concurrent refreshes with
 * the same rotated token invalidate each other.
 */
export async function ensureAccessToken(
  connection: ConnectionTokens,
  persist: (tokens: PersistedTokens) => Promise<void>,
): Promise<string> {
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0;

  if (connection.access_token_enc && expiresAt > Date.now() + 5 * 60 * 1000) {
    return decryptToken(connection.access_token_enc, connection.id);
  }

  if (!connection.refresh_token_enc) {
    throw new Error('This mailbox has no stored refresh token; it must be reconnected.');
  }

  const currentRefresh = decryptToken(connection.refresh_token_enc, connection.id);
  const refreshed = await refreshAccessToken(currentRefresh);

  await persist(encryptTokenSet(connection.id, refreshed, currentRefresh));
  return refreshed.accessToken;
}
