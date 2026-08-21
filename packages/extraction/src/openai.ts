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
  return response.output_parsed;
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
    return parsed;
  };

  try {
    return { data: await run(model), model };
  } catch (err) {
    const escalateModel = opts.escalateModel === undefined ? MODELS.escalate : opts.escalateModel;
    if (!escalateModel) throw err;
    return { data: await run(escalateModel), model: escalateModel };
  }
}
