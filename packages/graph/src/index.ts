export { encryptToken, decryptToken } from './crypto.js';
export { sendMailAsUser, isConsoleTransport } from './send.js';
export type { SentMessage, SendReplyInput, OutgoingAttachment } from './send.js';
export {
  GRAPH_SCOPES,
  missingScopes,
  createPkcePair,
  authorizeUrl,
  exchangeCode,
  refreshAccessToken,
  ReauthRequiredError,
} from './oauth.js';
export type { PkcePair, TokenSet } from './oauth.js';
export { graphFetch, graphJson, fetchIdentity, DeltaExpiredError } from './client.js';
export type { GraphIdentity } from './client.js';
export { primeDelta, pollDelta } from './delta.js';
export type { GraphMessage, DeltaResult } from './delta.js';
export {
  fetchAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './attachments.js';
export type { FetchedAttachment, SkippedAttachment, AttachmentResult } from './attachments.js';
export { ensureAccessToken, encryptTokenSet } from './tokens.js';
export type { ConnectionTokens, PersistedTokens } from './tokens.js';
