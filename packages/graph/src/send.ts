import { createHash } from 'node:crypto';
import { graphEnv } from '@checklist/config/env';
import { graphFetch, graphJson } from './client.js';

/**
 * Sending mail as the connected user.
 *
 * Always via a draft — create, fill in, read back, send — rather than the
 * one-shot `/me/sendMail`. Two reasons, both about the reply:
 *
 *  - Replying to the job's original email keeps Graph's `conversationId`, which
 *    is exactly what the ingest matcher keys on, so the shipper's answer lands
 *    back on the right job with no extra plumbing.
 *  - Reading the draft back before sending gives us that conversationId to
 *    store, which `/me/sendMail` never returns.
 */

export interface SentMessage {
  messageId: string;
  conversationId: string | null;
  internetMessageId: string | null;
  subject: string;
}

interface DraftMessage {
  id: string;
  subject: string | null;
  conversationId: string | null;
  internetMessageId: string | null;
}

export interface OutgoingAttachment {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface SendReplyInput {
  /** The message to reply to. Omit to start a new thread. */
  replyToMessageId?: string | null;
  to: string;
  subject: string;
  /** Plain text. Newlines become <br> so it renders in Outlook. */
  body: string;
  attachments?: OutgoingAttachment[];
}

/**
 * Graph accepts an attachment inline on a draft up to about 3 MB; past that it
 * needs a chunked upload session. A checklist PDF is a few tens of kilobytes,
 * so refusing the rare oversized one is better than carrying that machinery.
 */
const MAX_INLINE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text to the minimal HTML Outlook renders predictably. */
function toHtml(body: string): string {
  return `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;">${escapeHtml(body)
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

/**
 * True when outgoing mail is being printed rather than sent. Callers use this
 * to skip acquiring a real access token, which a fixture connection does not
 * have.
 */
export function isConsoleTransport(): boolean {
  return graphEnv().GRAPH_TRANSPORT === 'console';
}

export async function sendMailAsUser(
  accessToken: string,
  input: SendReplyInput,
): Promise<SentMessage> {
  if (isConsoleTransport()) {
    // Deterministic per thread, so a simulated reply lands on the same job the
    // real one would.
    const conversationId =
      input.replyToMessageId ??
      `console-${createHash('sha256').update(input.to + input.subject).digest('hex').slice(0, 24)}`;
    process.stdout.write(
      [
        '',
        '─'.repeat(72),
        '  OUTLOOK MAIL (not sent — GRAPH_TRANSPORT=console)',
        `  To:      ${input.to}`,
        `  Subject: ${input.subject}`,
        `  Thread:  ${conversationId}`,
        ...(input.attachments?.length
          ? [`  Attached: ${input.attachments.map((a) => a.fileName).join(', ')}`]
          : []),
        '─'.repeat(72),
        input.body,
        '─'.repeat(72),
        '',
      ].join('\n'),
    );
    return {
      messageId: `console-${conversationId}`,
      conversationId,
      internetMessageId: `<${conversationId}@console.local>`,
      subject: input.subject,
    };
  }

  // 1. Create the draft. Replying inherits the conversation; a fresh draft
  //    starts its own.
  const draft = input.replyToMessageId
    ? await graphJson<DraftMessage>(
        accessToken,
        `/me/messages/${input.replyToMessageId}/createReply`,
        { method: 'POST' },
      )
    : await graphJson<DraftMessage>(accessToken, '/me/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: input.subject, isDraft: true }),
      });

  // 2. Replace the body and redirect it at the shipper, who is often not the
  //    person who sent us the documents.
  //
  //    The subject deliberately keeps createReply's "RE: …" on a reply. Editing
  //    the subject of a threaded reply makes some clients treat the answer as a
  //    new conversation, which would break the matching this whole approach
  //    exists to get.
  const patch: Record<string, unknown> = {
    body: { contentType: 'HTML', content: toHtml(input.body) },
    toRecipients: [{ emailAddress: { address: input.to } }],
  };
  if (!input.replyToMessageId) patch.subject = input.subject;

  await graphFetch(accessToken, `/me/messages/${draft.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });

  // 3. Attach anything we are sending along, before the draft goes out.
  for (const attachment of input.attachments ?? []) {
    if (attachment.data.byteLength > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.fileName} is too large to attach (${Math.round(
          attachment.data.byteLength / 1024 / 1024,
        )} MB); the limit is 3 MB.`,
      );
    }
    await graphFetch(accessToken, `/me/messages/${draft.id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: attachment.fileName,
        contentType: attachment.contentType,
        contentBytes: attachment.data.toString('base64'),
      }),
    });
  }

  // 4. Read it back for the identifiers we need to match the reply.
  const saved = await graphJson<DraftMessage>(
    accessToken,
    `/me/messages/${draft.id}?$select=id,subject,conversationId,internetMessageId`,
  );

  // 5. Send.
  await graphFetch(accessToken, `/me/messages/${draft.id}/send`, { method: 'POST' });

  return {
    messageId: saved.id,
    conversationId: saved.conversationId,
    internetMessageId: saved.internetMessageId,
    subject: saved.subject ?? input.subject,
  };
}
