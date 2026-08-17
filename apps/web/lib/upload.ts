import 'server-only';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const OOXML = 'application/vnd.openxmlformats-officedocument';

/** Must stay a subset of the `job-documents` bucket's allowed_mime_types. */
const BY_EXTENSION: Record<string, string> = {
  docx: `${OOXML}.wordprocessingml.document`,
  xlsx: `${OOXML}.spreadsheetml.sheet`,
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
};

/**
 * What a file actually is, by its bytes.
 *
 * `container` types carry more than one format — every Office file since 2007
 * is a zip, and everything before it an OLE compound file — so the signature
 * narrows it to a family and the extension picks the member. Storage refuses a
 * mime outside the bucket's list only after the bytes have been transferred,
 * which is why this is decided here rather than left to the client's claim.
 */
const SIGNATURES: { mime: string | 'container'; matches: (head: Buffer) => boolean }[] = [
  { mime: 'application/pdf', matches: (h) => h.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', matches: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  { mime: 'image/png', matches: (h) => h.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' },
  // Zip (docx, xlsx) and OLE2 (doc, xls).
  {
    mime: 'container',
    matches: (h) => h[0] === 0x50 && h[1] === 0x4b && (h[2] === 0x03 || h[2] === 0x05),
  },
  { mime: 'container', matches: (h) => h.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1' },
];

/** The concrete Office type, or null when the extension does not name one. */
function officeMime(fileName: string): string | null {
  const extension = /\.([A-Za-z]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return (extension && BY_EXTENSION[extension]) ?? null;
}

/**
 * The stored mime for an upload, sniffed from the content rather than trusted
 * from the declared type — which the client sets and can say anything.
 * Null when it is not a format the bucket accepts.
 */
export function sniffMime(data: Buffer, fileName: string): string | null {
  const signature = SIGNATURES.find((s) => s.matches(data.subarray(0, 8)));
  if (!signature) return null;
  return signature.mime === 'container' ? officeMime(fileName) : signature.mime;
}

/** Storage keys are `{company}/{job}/{uuid}-{name}` — the storage RLS policy reads the first segment. */
export function safeFileName(fileName: string): string {
  return fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'document';
}
