import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { graphEnv } from '@checklist/config/env';

/**
 * AES-256-GCM for OAuth tokens at rest.
 *
 * Stored as `v1:<iv>:<tag>:<ciphertext>`, all base64url. The version prefix
 * exists so the key can be rotated later with a background re-encrypt pass
 * rather than a flag day.
 *
 * The connection id is bound in as additional authenticated data, so a
 * ciphertext copied from one row into another fails to decrypt instead of
 * silently handing over someone else's mailbox token.
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function key(): Buffer {
  return Buffer.from(graphEnv().TOKEN_ENCRYPTION_KEY, 'base64');
}

export function encryptToken(plaintext: string, connectionId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(connectionId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptToken(encoded: string, connectionId: string): string {
  const [version, ivB64, tagB64, dataB64] = encoded.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored token is not in the expected format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(Buffer.from(connectionId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
