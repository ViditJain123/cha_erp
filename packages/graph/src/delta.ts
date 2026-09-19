import { graphJson } from './client.js';

const DELTA_PATH = '/me/mailFolders/inbox/messages/delta';
/**
 * `body` and `bodyPreview` are here because the filing instructions live in
 * them and nowhere else. Which custom house to file at, whether the goods are
 * being warehoused, whether duty is deferred, the importer's own reference —
 * a customer states all of that in prose, and a delta that selects only the
 * envelope throws it away at the point of ingest. See
 * `packages/extraction/src/instructions.ts`.
 */
const SELECT =
  '$select=id,subject,conversationId,internetMessageId,receivedDateTime,hasAttachments,isDraft,from,bodyPreview,body';

export interface GraphMessage {
  id: string;
  subject: string | null;
  conversationId: string | null;
  internetMessageId: string | null;
  receivedDateTime: string | null;
  hasAttachments: boolean;
  isDraft?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
  /** First ~255 characters, plain text. Always present when `body` is. */
  bodyPreview?: string | null;
  body?: { contentType?: 'text' | 'html'; content?: string } | null;
}

interface DeltaPage {
  value: (GraphMessage & { '@removed'?: unknown })[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface DeltaResult {
  messages: GraphMessage[];
  /** Persist this; it is the cursor for the next poll. */
  deltaLink: string;
}

/**
 * Establishes a cursor representing "now" without reading history.
 *
 * `$deltatoken=latest` is the whole point: a cold delta call enumerates the
 * entire inbox, which for a real CHA mailbox is tens of thousands of messages
 * and would try to classify every historical attachment on first connect.
 */
export async function primeDelta(accessToken: string): Promise<string> {
  const page = await graphJson<DeltaPage>(
    accessToken,
    `${DELTA_PATH}?${SELECT}&$deltatoken=latest`,
  );
  const deltaLink = page['@odata.deltaLink'];
  if (!deltaLink) throw new Error('Microsoft did not return a delta cursor when priming.');
  return deltaLink;
}

/**
 * Reads everything that changed since `deltaLink`, following pagination to the
 * end, and returns the next cursor.
 *
 * Graph reports updates as well as new mail — a message being marked read comes
 * back through here — so callers must dedupe on the message id rather than
 * assume everything returned is new.
 */
export async function pollDelta(
  accessToken: string,
  deltaLink: string,
  maxPages = 50,
): Promise<DeltaResult> {
  const messages: GraphMessage[] = [];
  let url: string | undefined = deltaLink;
  let nextCursor: string | undefined;

  for (let page = 0; page < maxPages && url; page++) {
    const body: DeltaPage = await graphJson<DeltaPage>(accessToken, url);

    for (const item of body.value ?? []) {
      // Tombstones for deleted mail carry no usable content.
      if ('@removed' in item) continue;
      if (item.isDraft) continue;
      messages.push(item);
    }

    nextCursor = body['@odata.deltaLink'] ?? nextCursor;
    url = body['@odata.nextLink'];
  }

  return {
    messages,
    // If we hit the page cap the cursor is unchanged, so the remainder is
    // picked up on the next tick rather than being skipped.
    deltaLink: nextCursor ?? deltaLink,
  };
}
