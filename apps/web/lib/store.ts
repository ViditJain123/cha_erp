import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChecklistDraft, ExtractedDoc } from '@checklist/extraction';

/**
 * File-based job store (v1 dev). Interface mirrors what a Postgres-backed
 * store will implement; every record carries tenantId already.
 */

export type JobStatus = 'processing' | 'review' | 'approved' | 'failed';

export interface JobRecord {
  id: string;
  tenantId: string;
  jobNumber: string;
  createdAt: string;
  status: JobStatus;
  fileNames: string[];
  draft: ChecklistDraft | null;
  docs: ExtractedDoc[] | null;
  error?: string;
  approvedAt?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'jobs');

function jobDir(id: string) {
  return path.join(DATA_DIR, id);
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

export async function createJob(files: { fileName: string; data: Buffer }[]): Promise<JobRecord> {
  const id = randomUUID().slice(0, 8);
  const dir = jobDir(id);
  await ensureDir(path.join(dir, 'files'));
  for (const f of files) {
    await writeFile(path.join(dir, 'files', path.basename(f.fileName)), f.data);
  }
  const existing = await listJobs();
  const seq = 13900 + existing.length; // dev job-number counter; per-tenant sequence in prod
  const job: JobRecord = {
    id,
    tenantId: 'kuberr',
    jobNumber: `I-${seq}/26-27`,
    createdAt: new Date().toISOString(),
    status: 'processing',
    fileNames: files.map((f) => path.basename(f.fileName)),
    draft: null,
    docs: null,
  };
  await saveJob(job);
  return job;
}

export async function saveJob(job: JobRecord): Promise<void> {
  await ensureDir(jobDir(job.id));
  await writeFile(path.join(jobDir(job.id), 'job.json'), JSON.stringify(job, null, 2));
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const p = path.join(jobDir(id), 'job.json');
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8')) as JobRecord;
}

export async function listJobs(): Promise<JobRecord[]> {
  if (!existsSync(DATA_DIR)) return [];
  const ids = await readdir(DATA_DIR);
  const jobs = await Promise.all(ids.map((id) => getJob(id)));
  return jobs
    .filter((j): j is JobRecord => j !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readJobFile(id: string, fileName: string): Promise<Buffer | null> {
  const p = path.join(jobDir(id), 'files', path.basename(fileName));
  if (!existsSync(p)) return null;
  return readFile(p);
}

export async function writeJobPdf(id: string, pdf: Buffer): Promise<void> {
  await writeFile(path.join(jobDir(id), 'checklist.pdf'), pdf);
}

export async function readJobPdf(id: string): Promise<Buffer | null> {
  const p = path.join(jobDir(id), 'checklist.pdf');
  if (!existsSync(p)) return null;
  return readFile(p);
}
