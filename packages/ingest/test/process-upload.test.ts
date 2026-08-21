import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateIdentifier } from '../src/match.js';
import type { TriageResult } from '../src/triage.js';

const triageDocument = vi.fn<(fileName: string, data: Buffer, mimeType?: string) => Promise<TriageResult>>();

vi.mock('../src/triage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/triage.js')>()),
  triageDocument: (...args: Parameters<typeof triageDocument>) => triageDocument(...args),
}));

const { processUpload } = await import('../src/process.js');

/** A triage result with everything null but the fields a test cares about. */
function triage(over: Partial<TriageResult> = {}): TriageResult {
  return {
    docType: 'invoice',
    reason: 'test',
    blNumber: null,
    awbNumber: null,
    invoiceNumber: null,
    containerNumbers: [],
    poNumber: null,
    importerName: null,
    supplierName: null,
    summary: 'a document',
    goodsDescription: null,
    hsCodes: [],
    blSurrenderIndication: null,
    detentionFreeDays: null,
    shippingLine: null,
    containerMode: null,
    model: 'test-model',
    ...over,
  };
}

interface Fixtures {
  /** Rows `job_identifiers` returns for the candidate lookup. */
  identifiers?: CandidateIdentifier[];
  /** Rows `job_documents` returns for the digest lookup. */
  documents?: { id: string; job_id: string; sha256: string }[];
}

interface Writes {
  jobs: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  events: Record<string, unknown>[];
  identifiers: Record<string, unknown>[];
  uploads: string[];
}

/**
 * The narrow slice of the Supabase client `processUpload` actually drives.
 *
 * Every builder method returns the same object and the object is thenable, so
 * any chain of .select().eq().in() resolves to the fixture for its table.
 */
function fakeDb(fixtures: Fixtures = {}) {
  const writes: Writes = { jobs: [], documents: [], events: [], identifiers: [], uploads: [] };

  function query(table: string) {
    let op = 'select';
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    const result = () => {
      if (op === 'insert' && table === 'jobs') {
        return { data: { id: `job-new-${writes.jobs.length}` }, error: null };
      }
      if (op !== 'select') return { data: null, error: null };
      if (table === 'job_identifiers') return { data: fixtures.identifiers ?? [], error: null };
      if (table === 'job_documents') return { data: fixtures.documents ?? [], error: null };
      if (table === 'jobs') return { data: { hs_codes: [] }, error: null };
      return { data: [], error: null };
    };

    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      builder[method] = chain;
    }
    builder.insert = (rows: unknown) => {
      op = 'insert';
      const list = Array.isArray(rows) ? rows : [rows];
      const bucket =
        table === 'jobs' ? writes.jobs
        : table === 'job_documents' ? writes.documents
        : table === 'job_events' ? writes.events
        : writes.identifiers;
      bucket.push(...(list as Record<string, unknown>[]));
      return builder;
    };
    builder.upsert = (rows: unknown) => {
      op = 'upsert';
      writes.identifiers.push(...(rows as Record<string, unknown>[]));
      return builder;
    };
    builder.update = () => {
      op = 'update';
      return builder;
    };
    builder.single = () => Promise.resolve(result());
    builder.maybeSingle = () => Promise.resolve(result());
    builder.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(onOk, onErr);

    return builder;
  }

  const db = {
    from: (table: string) => query(table),
    storage: {
      from: () => ({
        upload: (path: string) => {
          writes.uploads.push(path);
          return Promise.resolve({ error: null });
        },
      }),
    },
  };

  return { db: db as never, writes };
}

const file = (fileName: string, body = fileName) => ({
  fileName,
  contentType: 'application/pdf',
  data: Buffer.from(body),
});

beforeEach(() => triageDocument.mockReset());

describe('processUpload', () => {
  it('opens a job even when nothing in the batch is a recognised trade document', async () => {
    // The mail path skips this batch. A person who dropped the files has said
    // they want a job, so it must not be skipped here.
    triageDocument.mockResolvedValue(triage({ docType: 'unknown' }));
    const { db, writes } = fakeDb();

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('scan.pdf')],
    });

    expect(result.outcome).toBe('created_job');
    expect(result.created).toBe(true);
    expect(result.documentsAdded).toBe(1);
    expect(writes.jobs).toHaveLength(1);
    expect(writes.jobs[0]).toMatchObject({ source: 'manual', created_by: 'user-1' });
    expect(writes.documents[0]).toMatchObject({ source: 'upload', uploaded_by: 'user-1' });
    expect(writes.events[0]).toMatchObject({ type: 'job.created_from_upload' });
  });

  it('attaches to the job whose bill of lading the batch names', async () => {
    triageDocument.mockResolvedValue(
      triage({ docType: 'bill_of_lading', blNumber: 'MEDU 1234 5678' }),
    );
    const { db, writes } = fakeDb({
      identifiers: [{ job_id: 'job-7', kind: 'bl', value: 'MEDU12345678' }],
    });

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('bl.pdf')],
    });

    expect(result.outcome).toBe('attached');
    expect(result.jobId).toBe('job-7');
    expect(writes.jobs).toHaveLength(0);
    expect(writes.events[0]).toMatchObject({ type: 'upload.attached', job_id: 'job-7' });
  });

  it('refuses to guess when two jobs match equally well, and writes nothing', async () => {
    // One B/L per file, each naming a different job — nothing separates them.
    triageDocument.mockImplementation(async (fileName) =>
      triage({
        docType: 'bill_of_lading',
        blNumber: fileName === 'one.pdf' ? 'MEDU12345678' : 'MSCU87654321',
      }),
    );
    const { db, writes } = fakeDb({
      identifiers: [
        { job_id: 'job-1', kind: 'bl', value: 'MEDU12345678' },
        { job_id: 'job-2', kind: 'bl', value: 'MSCU87654321' },
      ],
    });

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('one.pdf'), file('two.pdf')],
    });

    expect(result.outcome).toBe('ambiguous');
    expect(result.jobId).toBeUndefined();
    expect(result.candidateJobIds).toEqual(expect.arrayContaining(['job-1', 'job-2']));
    expect(writes.jobs).toHaveLength(0);
    expect(writes.documents).toHaveLength(0);
    expect(writes.uploads).toHaveLength(0);
    expect(writes.events[0]).toMatchObject({ type: 'upload.ambiguous' });
  });

  it('lands a re-dropped folder back on the job that already holds it', async () => {
    // No identifier was read off these scans, so only the digests connect them
    // to the job the first drop opened.
    triageDocument.mockResolvedValue(triage({ docType: 'unknown' }));
    const { createHash } = await import('node:crypto');
    const digest = (body: string) => createHash('sha256').update(body).digest('hex');

    const { db, writes } = fakeDb({
      documents: [
        { id: 'doc-1', job_id: 'job-3', sha256: digest('a.pdf') },
        { id: 'doc-2', job_id: 'job-3', sha256: digest('b.pdf') },
      ],
    });

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('a.pdf'), file('b.pdf')],
    });

    expect(result.outcome).toBe('attached');
    expect(result.jobId).toBe('job-3');
    expect(result.documentsAdded).toBe(0);
    expect(result.documentsDuplicate).toBe(2);
    expect(writes.jobs).toHaveLength(0);
    expect(writes.uploads).toHaveLength(0);
  });

  it('stores the same file twice in one batch only once', async () => {
    triageDocument.mockResolvedValue(triage({ docType: 'invoice' }));
    const { db, writes } = fakeDb();

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('invoice.pdf', 'same'), file('invoice-copy.pdf', 'same')],
    });

    expect(result.documentsAdded).toBe(1);
    expect(result.documentsDuplicate).toBe(1);
    expect(writes.documents).toHaveLength(1);
  });

  it('reads each file back with what it was taken to be', async () => {
    triageDocument.mockImplementation(async (fileName) =>
      triage({ docType: fileName === 'bl.pdf' ? 'bill_of_lading' : 'packing_list' }),
    );
    const { db } = fakeDb();

    const result = await processUpload(db, {
      companyId: 'co-1',
      uploadedBy: 'user-1',
      files: [file('bl.pdf'), file('pl.pdf')],
    });

    expect(result.files).toEqual([
      { fileName: 'bl.pdf', docType: 'bill_of_lading', duplicate: false },
      { fileName: 'pl.pdf', docType: 'packing_list', duplicate: false },
    ]);
  });

  it('refuses an empty batch', async () => {
    const { db } = fakeDb();
    await expect(
      processUpload(db, { companyId: 'co-1', uploadedBy: 'user-1', files: [] }),
    ).rejects.toThrow(/at least one/i);
  });
});
