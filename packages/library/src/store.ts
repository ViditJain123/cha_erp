import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Official-document library on disk:
 *   <LIBRARY_DIR>/docs/<id>.pdf + <id>.json   (document + metadata)
 *   <LIBRARY_DIR>/index/chunks.jsonl          (chunk text + doc/page attribution)
 *   <LIBRARY_DIR>/index/embeddings.f32        (float32 vectors, row-aligned with chunks)
 *   <LIBRARY_DIR>/index/meta.json             ({model, dims, count})
 */

export type DocKind = 'tariff-chapter' | 'notification' | 'exchange-rate' | 'other';

export interface LibraryDocMeta {
  id: string;
  kind: DocKind;
  title: string;
  sourceUrl: string;
  chapter?: number;
  edition?: string;
  notification?: string;
  fetchedAt: string;
  pages?: number;
  indexedAt?: string;
}

export function libraryDir(): string {
  return process.env.LIBRARY_DIR ?? path.join(process.cwd(), 'data', 'library');
}
export function docsDir(): string {
  return path.join(libraryDir(), 'docs');
}
export function indexDir(): string {
  return path.join(libraryDir(), 'index');
}

export function saveDoc(meta: LibraryDocMeta, pdf: Buffer): void {
  mkdirSync(docsDir(), { recursive: true });
  writeFileSync(path.join(docsDir(), `${meta.id}.pdf`), pdf);
  writeFileSync(path.join(docsDir(), `${meta.id}.json`), JSON.stringify(meta, null, 2));
}

export function updateDocMeta(meta: LibraryDocMeta): void {
  writeFileSync(path.join(docsDir(), `${meta.id}.json`), JSON.stringify(meta, null, 2));
}

export function readDocPdf(id: string): Buffer {
  return readFileSync(path.join(docsDir(), `${id}.pdf`));
}

export function listDocs(): LibraryDocMeta[] {
  if (!existsSync(docsDir())) return [];
  return readdirSync(docsDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(docsDir(), f), 'utf8')) as LibraryDocMeta)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function getDoc(id: string): LibraryDocMeta | undefined {
  const p = path.join(docsDir(), `${id}.json`);
  if (!existsSync(p)) return undefined;
  return JSON.parse(readFileSync(p, 'utf8')) as LibraryDocMeta;
}
