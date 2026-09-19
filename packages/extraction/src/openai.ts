import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

/** GPT-5.6 family (verified on this account, Aug 2026). */
export const MODELS = {
  /** cheap classification */
  classify: 'gpt-5.6-luna',
  /** extraction workhorse */
  extract: 'gpt-5.6-terra',
  /** escalation when extraction fails validation */
  escalate: 'gpt-5.6-sol',
} as const;

let _client: OpenAI | undefined;
export function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    _client = new OpenAI();
  }
  return _client;
}

export function pdfInputPart(fileName: string, pdf: Buffer) {
  return {
    type: 'input_file' as const,
    filename: fileName,
    file_data: `data:application/pdf;base64,${pdf.toString('base64')}`,
  };
}

/**
 * One document as model input, whatever form it arrived in.
 *
 * PDFs go in as files; a photographed or scanned document — routine once people
 * start dropping whatever the shipper sent them on WhatsApp — has to go in as an
 * image instead, because the file part only speaks PDF. Anything else throws
 * rather than being sent as a PDF that is not one.
 */
export function documentInputPart(fileName: string, data: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return pdfInputPart(fileName, data);
  if (mimeType.startsWith('image/')) {
    return {
      type: 'input_image' as const,
      // Scans of shipping documents are dense small print; 'low' detail
      // downsamples them past the point a B/L number is legible.
      detail: 'high' as const,
      image_url: `data:${mimeType};base64,${data.toString('base64')}`,
    };
  }
  throw new Error(`${mimeType || 'That file type'} cannot be read by the model`);
}

/**
 * The words a model uses when it means "this field is not on the document".
 *
 * `null` is what the schema asks for and usually what comes back. But the
 * instruction "return null when absent" is one a model can follow in the wrong
 * register, and then the *word* arrives instead: a corpus run over 32 jobs
 * produced ">null" as an importer's name, ":null" as a country of origin and
 * "/null" as an invoice date, each from a different document. A placeholder a
 * person types on the paper itself — "N/A", "NIL", "—" — says the same thing
 * and arrives the same way.
 *
 * They are stripped here, at the one boundary every extraction crosses, rather
 * than in each of the hundred fields downstream. The difference matters: a
 * `null` reaches a check that knows the field is missing, where ">null" is a
 * value, and every later step treats it as one — the importer is not looked up,
 * the country is not coded, and a Bill of Entry goes out saying so.
 */
const PLACEHOLDERS = new Set(['NULL', 'NA', 'NIL', 'NONE', 'UNDEFINED', 'NOTAPPLICABLE', 'NOTAVAILABLE']);

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const bare = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  // Punctuation alone — "-", "--", "/" — is a person writing "nothing here".
  if (!bare) return true;
  // So is a run of X's: a bill of lading whose place-of-delivery box reads
  // "XXXXXXXXXXXXXXXX" has been struck out, not filled in. Three or more, so a
  // real value is never caught by it.
  if (/^X{3,}$/.test(bare)) return true;
  return PLACEHOLDERS.has(bare);
}

function scrub(value: unknown, empty: null | ''): unknown {
  if (typeof value === 'string') return isPlaceholder(value) ? empty : value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, empty));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, empty)]));
  }
  return value;
}

/**
 * Strip the placeholders out of a parsed response, keeping it valid.
 *
 * A nullable field becomes null; a field the schema declares as a plain string
 * cannot, so the whole object is re-validated and the emptier form is only kept
 * when it still parses. Failing both, the response is returned untouched —
 * scrubbing is a repair, and a repair that breaks the shape is worse than the
 * damage.
 */
export function scrubPlaceholders<T extends z.ZodType>(schema: T, parsed: z.infer<T>): z.infer<T> {
  for (const empty of [null, ''] as const) {
    const candidate = scrub(parsed, empty);
    const check = schema.safeParse(candidate);
    if (check.success) return check.data as z.infer<T>;
  }
  return parsed;
}

/** One structured-output call over plain text (no document attached). */
export async function structuredTextCall<T extends z.ZodType>(opts: {
  schema: T;
  schemaName: string;
  system: string;
  userText: string;
  model?: string;
}): Promise<z.infer<T>> {
  const response = await client().responses.parse({
    model: opts.model ?? MODELS.classify,
    input: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.userText },
    ],
    text: { format: zodTextFormat(opts.schema, opts.schemaName) },
  });
  if (response.output_parsed == null) throw new Error(`no parsed output (${response.status})`);
  return scrubPlaceholders(opts.schema, response.output_parsed);
}

/**
 * One structured-output call against a PDF. Tries `model`, escalates to
 * `escalateModel` when the response fails to parse/validate.
 */
export async function structuredPdfCall<T extends z.ZodType>(opts: {
  schema: T;
  schemaName: string;
  system: string;
  userText: string;
  fileName: string;
  pdf: Buffer;
  /** Defaults to PDF; images are sent as images. */
  mimeType?: string;
  model?: string;
  escalateModel?: string | null;
}): Promise<{ data: z.infer<T>; model: string }> {
  const model = opts.model ?? MODELS.extract;
  const part = documentInputPart(opts.fileName, opts.pdf, opts.mimeType ?? 'application/pdf');
  const run = async (m: string) => {
    const response = await client().responses.parse({
      model: m,
      input: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: [part, { type: 'input_text', text: opts.userText }],
        },
      ],
      text: { format: zodTextFormat(opts.schema, opts.schemaName) },
    });
    const parsed = response.output_parsed;
    if (parsed == null) throw new Error(`no parsed output from ${m} (${response.status})`);
    return scrubPlaceholders(opts.schema, parsed);
  };

  try {
    return { data: await run(model), model };
  } catch (err) {
    const escalateModel = opts.escalateModel === undefined ? MODELS.escalate : opts.escalateModel;
    if (!escalateModel) throw err;
    return { data: await run(escalateModel), model: escalateModel };
  }
}
