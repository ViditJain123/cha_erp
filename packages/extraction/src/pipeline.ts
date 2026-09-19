import { verifyContainers } from './containers.js';
import { classifyDoc, extractDoc } from './extract.js';
import { mergeToDraft } from './merge.js';
import type { ChecklistDraft } from './draft.js';
import type { BlExtract, ExtractedDoc } from './schemas.js';

export interface PipelineInputFile {
  fileName: string;
  pdf: Buffer;
  /**
   * The document's media type, when it is not a PDF.
   *
   * Ingest has read photographs since it was written — a shipper who sends a
   * scan on WhatsApp is the ordinary case, and two jobs in the corpus carry
   * their bill of lading as a `.jpg` and nothing else. The extraction pipeline
   * sent every file as `application/pdf` regardless, so those documents were
   * classified and extracted as a PDF that they are not: the job reached the
   * header with no transport document at all.
   */
  mimeType?: string;
}

export interface PipelineProgress {
  (event: {
    stage: 'classify' | 'extract' | 'containers' | 'merge';
    fileName?: string;
    detail?: string;
  }): void;
}

/** Full pipeline: PDFs in → reviewable checklist draft out. */
export async function runPipeline(
  files: PipelineInputFile[],
  opts?: { onProgress?: PipelineProgress; today?: string },
): Promise<{ draft: ChecklistDraft; docs: ExtractedDoc[] }> {
  // One attachment can hold several documents, so a file fans out to one
  // extraction per type the classifier found in it. The whole PDF is sent each
  // time with a different prompt, rather than being split — reading thirteen
  // pages five times costs calls, and losing four of five documents costs a
  // Bill of Entry.
  const perFile = await Promise.all(
    files.map(async (f): Promise<ExtractedDoc[]> => {
      opts?.onProgress?.({ stage: 'classify', fileName: f.fileName });
      const docTypes = await classifyDoc(f.fileName, f.pdf, f.mimeType);
      return Promise.all(
        docTypes.map((docType) => {
          opts?.onProgress?.({
            stage: 'extract',
            fileName: f.fileName,
            detail: docTypes.length > 1 ? `${docType} (1 of ${docTypes.length} in this file)` : docType,
          });
          return extractDoc(f.fileName, f.pdf, docType, f.mimeType);
        }),
      );
    }),
  );
  const docs = perFile.flat();

  // The container list gets a second look before anything is merged. It is the
  // one field on a B/L that has come back wrong on every job we hold — one box
  // out of four, one out of six — and it is the one whose being wrong is
  // invisible in the finished workbook.
  const pdfByName = new Map(files.map((f) => [f.fileName, f] as const));
  await Promise.all(
    docs.map(async (doc) => {
      if (doc.docType !== 'bill_of_lading' || doc.data == null) return;
      const source = pdfByName.get(doc.fileName);
      if (!source) return;
      const bl = doc.data as BlExtract;
      opts?.onProgress?.({
        stage: 'containers',
        fileName: doc.fileName,
        detail: `read ${bl.containers.length}, B/L states ${bl.containerCount ?? '?'}`,
      });
      const { bl: checked, reread } = await verifyContainers(
        bl,
        doc.fileName,
        source.pdf,
        source.mimeType,
      );
      if (!reread) return;
      doc.data = checked;
      opts?.onProgress?.({
        stage: 'containers',
        fileName: doc.fileName,
        detail:
          `re-read found ${reread.containers.length} (${reread.whereListed ?? 'unstated'}); ` +
          `list is now ${checked.containers.length}, stated ${checked.containerCount ?? '?'}`,
      });
    }),
  );

  opts?.onProgress?.({ stage: 'merge' });
  const draft = mergeToDraft(docs, opts?.today !== undefined ? { today: opts.today } : undefined);
  return { draft, docs };
}
