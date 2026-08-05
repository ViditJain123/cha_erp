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
  model?: string;
  escalateModel?: string | null;
}): Promise<{ data: z.infer<T>; model: string }> {
  const model = opts.model ?? MODELS.extract;
  const run = async (m: string) => {
    const response = await client().responses.parse({
      model: m,
      input: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: [
            pdfInputPart(opts.fileName, opts.pdf),
            { type: 'input_text', text: opts.userText },
          ],
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
