import { classifyDoc, extractDoc } from './extract.js';
import { mergeToDraft } from './merge.js';
import type { ChecklistDraft } from './draft.js';
import type { ExtractedDoc } from './schemas.js';

export interface PipelineInputFile {
  fileName: string;
  pdf: Buffer;
}

export interface PipelineProgress {
  (event: { stage: 'classify' | 'extract' | 'merge'; fileName?: string; detail?: string }): void;
}

/** Full pipeline: PDFs in → reviewable checklist draft out. */
export async function runPipeline(
  files: PipelineInputFile[],
  opts?: { onProgress?: PipelineProgress; today?: string },
): Promise<{ draft: ChecklistDraft; docs: ExtractedDoc[] }> {
  const docs = await Promise.all(
    files.map(async (f): Promise<ExtractedDoc> => {
      opts?.onProgress?.({ stage: 'classify', fileName: f.fileName });
      const docType = await classifyDoc(f.fileName, f.pdf);
      opts?.onProgress?.({ stage: 'extract', fileName: f.fileName, detail: docType });
      return extractDoc(f.fileName, f.pdf, docType);
    }),
  );
  opts?.onProgress?.({ stage: 'merge' });
  const draft = mergeToDraft(docs, opts?.today !== undefined ? { today: opts.today } : undefined);
  return { draft, docs };
}
