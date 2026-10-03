import { pdfPageTexts } from '@checklist/library';
import { documentInputPart } from '../openai.js';
import type { ToolOutput, ToolOutputPart } from './loop.js';

/**
 * A job file as the agent may read it.
 *
 * `hint` is ingest's own classification of the file (`job_documents.doc_type`),
 * which names licences and orders that extraction typed as `other`. It is what
 * tells the agent there is a licence on the job worth opening.
 */
export interface AgentFile {
  fileName: string;
  pdf: Buffer;
  mimeType?: string;
  hint?: string;
}

/** Below this many characters a page has no usable text layer. */
const TEXT_LAYER_MIN = 40;
export const MAX_PAGES_PER_READ = 6;
export const MAX_CHARS_PER_PAGE = 6_000;
/** Above this a scan is not sent as an image at all; the model is told to ask for text. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export interface ReadDocumentArgs {
  fileName: string;
  /** 1-based; null for the first pages. */
  pages: number[] | null;
  /** `text` returns the text layer; `image` sends the file itself for the model to look at. */
  mode: 'text' | 'image';
}

const textCache = new WeakMap<Buffer, Promise<string[]>>();

/** Page texts of a PDF, read once per buffer. Empty for a non-PDF. */
export async function pageTexts(file: AgentFile): Promise<string[]> {
  if ((file.mimeType ?? 'application/pdf') !== 'application/pdf') return [];
  let cached = textCache.get(file.pdf);
  if (!cached) {
    cached = pdfPageTexts(file.pdf).catch(() => [] as string[]);
    textCache.set(file.pdf, cached);
  }
  return cached;
}

export function hasTextLayer(texts: string[]): boolean {
  return texts.some((t) => t.trim().length >= TEXT_LAYER_MIN);
}

/**
 * The `read_document` tool.
 *
 * Text when there is a text layer: cheap, and the quotes the agent returns can
 * be checked against it. The file itself only when there is none, or when the
 * agent asks to look — a scanned licence is the ordinary case — and never
 * beyond the size a single turn should carry.
 */
export async function readDocument(files: AgentFile[], args: ReadDocumentArgs): Promise<ToolOutput> {
  const file = files.find((f) => f.fileName === args.fileName);
  if (!file) {
    return `Error: no file named "${args.fileName}" on this job. The files are: ${files.map((f) => f.fileName).join(', ')}.`;
  }
  const texts = await pageTexts(file);
  const wantImage = args.mode === 'image' || !hasTextLayer(texts);

  if (wantImage) {
    if (file.pdf.length > MAX_IMAGE_BYTES) {
      return `Error: ${file.fileName} is ${(file.pdf.length / 1024 / 1024).toFixed(1)} MB, too large to send as an image. ` +
        (hasTextLayer(texts) ? 'Ask for it in text mode.' : 'It has no text layer; ask the operator what it says.');
    }
    const part = documentInputPart(file.fileName, file.pdf, file.mimeType ?? 'application/pdf') as ToolOutputPart;
    const note: ToolOutputPart = {
      type: 'input_text',
      text: `${file.fileName}: ${hasTextLayer(texts) ? 'sent as an image on request' : 'no text layer, sent as an image'}` +
        `${texts.length ? `, ${texts.length} page(s)` : ''}. Quote what you read from it verbatim.`,
    };
    return [note, part];
  }

  const wanted = (args.pages?.length ? args.pages : texts.map((_, i) => i + 1))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= texts.length)
    .slice(0, MAX_PAGES_PER_READ);
  if (!wanted.length) return `Error: ${file.fileName} has ${texts.length} page(s); none of the pages asked for exist.`;
  const parts: ToolOutputPart[] = wanted.map((p) => {
    const text = texts[p - 1]!.replace(/[ \t]+\n/g, '\n').trim();
    const cut = text.length > MAX_CHARS_PER_PAGE;
    return {
      type: 'input_text',
      text: `--- ${file.fileName} page ${p} of ${texts.length}${cut ? ` (first ${MAX_CHARS_PER_PAGE} characters)` : ''} ---\n${text.slice(0, MAX_CHARS_PER_PAGE)}`,
    };
  });
  if (texts.length > wanted.length) {
    parts.push({ type: 'input_text', text: `(${texts.length - wanted.length} more page(s) not shown; ask for them by number.)` });
  }
  return parts;
}
