import { graphJson } from './client.js';

const DELTA_PATH = '/me/mailFolders/inbox/messages/delta';
const SELECT =
  '$select=id,subject,conversationId,internetMessageId,receivedDateTime,hasAttachments,isDraft,from';

export interface GraphMessage {
  id: string;
  subject: string | null;
  conversationId: string | null;
  internetMessageId: string | null;
  receivedDateTime: string | null;
  hasAttachments: boolean;
  isDraft?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
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
