import { graphFetch, graphJson } from './client.js';

/** Ignore anything larger than this; a trade document is never 25 MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 15;

interface AttachmentMeta {
  id: string;
  name: string;
  contentType: string | null;
  size: number;
  isInline: boolean;
  '@odata.type': string;
}

interface AttachmentListResponse {
  value: AttachmentMeta[];
}

export interface FetchedAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  data: Buffer;
}

export interface SkippedAttachment {
  fileName: string;
  reason: 'inline' | 'too_large' | 'unsupported_type' | 'not_a_file';
}

export interface AttachmentResult {
  files: FetchedAttachment[];
  skipped: SkippedAttachment[];
}

/** What the classifier can actually read today. */
function isSupported(contentType: string | null, fileName: string): boolean {
  if (contentType?.toLowerCase().startsWith('application/pdf')) return true;
  return fileName.toLowerCase().endsWith('.pdf');
}

/**
 * Downloads a message's file attachments.
 *
 * Deliberately narrow: only `fileAttachment` is handled. `itemAttachment` is a
 * nested email and `referenceAttachment` is a OneDrive link carrying no bytes —
 * both would need different handling and neither appears on the shipment mail
 * we care about. Both are reported as skipped rather than dropped silently, so
 * they show up in the UI if that assumption turns out to be wrong.
 */
export async function fetchAttachments(
  accessToken: string,
  messageId: string,
): Promise<AttachmentResult> {
  const list = await graphJson<AttachmentListResponse>(
    accessToken,
    `/me/messages/${messageId}/attachments?$select=id,name,contentType,size,isInline`,
  );

  const files: FetchedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];

  for (const meta of (list.value ?? []).slice(0, MAX_ATTACHMENTS_PER_MESSAGE)) {
    const fileName = meta.name ?? 'attachment';

    if (!meta['@odata.type']?.includes('fileAttachment')) {
      skipped.push({ fileName, reason: 'not_a_file' });
      continue;
    }
    // Signature logos and embedded images.
    if (meta.isInline) {
      skipped.push({ fileName, reason: 'inline' });
      continue;
    }
    if (meta.size > MAX_ATTACHMENT_BYTES) {
      skipped.push({ fileName, reason: 'too_large' });
      continue;
    }
    if (!isSupported(meta.contentType, fileName)) {
      skipped.push({ fileName, reason: 'unsupported_type' });
      continue;
    }

    // Always fetch through /$value: attachments over ~3 MB do not come back
    // inline as contentBytes on the list response.
    const response = await graphFetch(
      accessToken,
      `/me/messages/${messageId}/attachments/${meta.id}/$value`,
    );
    files.push({
      id: meta.id,
      fileName,
      contentType: meta.contentType ?? 'application/pdf',
      size: meta.size,
      data: Buffer.from(await response.arrayBuffer()),
    });
  }

  return { files, skipped };
}
