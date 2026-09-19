import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DECLARATIONS,
  FTA_SCHEMES,
  IMPORTERS,
  PORTS,
  TARIFF,
  type DeclarationMaster,
  type ExchangeRateMaster,
  type FtaSchemeMaster,
  type ImporterMaster,
  type PortMaster,
  type TariffMaster,
} from './data.js';
import { GENERATED_EXCHANGE_RATES } from './generated/exchange-rates.js';
import { tariffBookMasters } from './tariff-book.js';

/**
 * Mutable masters store: compiled seed data + a JSON overlay directory
 * (MASTERS_DIR env, or <cwd>/data/masters). Reviewer corrections and admin
 * edits land in the overlay; seeds stay in code. Same shape as the future
 * Postgres tables.
 */

/** Learned mapping: importer + product description prefix -> tariff defaults. */
export interface ProductMemory {
  importerKey: string;
  descriptionKey: string;
  ritc: string;
  bcdRate: number;
  igstRate: number;
  igstNotification?: string;
  bcdNotification?: string;
  learnedFrom: string;
  learnedAt: string;
}

export interface MastersOverlay {
  tariff: TariffMaster[];
  importers: ImporterMaster[];
  exchangeRates: ExchangeRateMaster[];
  productMemory: ProductMemory[];
}

const EMPTY_OVERLAY: MastersOverlay = { tariff: [], importers: [], exchangeRates: [], productMemory: [] };

function overlayDir(): string {
  return process.env.MASTERS_DIR ?? path.join(process.cwd(), 'data', 'masters');
}

function overlayPath(name: keyof MastersOverlay): string {
  const file = { tariff: 'tariff.json', importers: 'importers.json', exchangeRates: 'exchange-rates.json', productMemory: 'product-memory.json' }[name];
  return path.join(overlayDir(), file);
}

function readOverlay<K extends keyof MastersOverlay>(name: K): MastersOverlay[K] {
  const p = overlayPath(name);
  if (!existsSync(p)) return EMPTY_OVERLAY[name];
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as MastersOverlay[K];
  } catch {
    return EMPTY_OVERLAY[name];
  }
}

function writeOverlay<K extends keyof MastersOverlay>(name: K, data: MastersOverlay[K]): void {
  mkdirSync(overlayDir(), { recursive: true });
  writeFileSync(overlayPath(name), JSON.stringify(data, null, 2));
  // mtime has a coarse resolution on some filesystems, so a write inside the
  // same millisecond as the last read would not invalidate the cache on its
  // own. Clearing it here makes upsert-then-lookup correct regardless.
  if (name === 'tariff') tariffCache = null;
}

/* ---------- merged reads (overlay wins on key collision) ---------- */

/**
 * The tariff master, in three layers.
 *
 * Highest first: the overlay (a reviewer's correction, or a rate learned from
 * an approved job), then the hand-typed seed in data.ts, then the ~12,000 rows
 * parsed from the printed tariff book. A CTH resolves to the most authored
 * reading of it that exists.
 *
 * The seed sits above the book deliberately. Its three rows were transcribed
 * from real filed jobs, and `masters-store.test.ts` pins them; the book
 * reproduces all three exactly, which is the evidence that the parse can be
 * trusted with the other 12,000. If that ever stops being true it should
 * surface as a failing test, not as a silently changed duty.
 */
export function allTariff(): TariffMaster[] {
  return tariffIndex().ordered;
}

/**
 * Indexed and memoised, because this is now a hot path over 12,000 rows rather
 * than a cold one over three. `lookupTariff` is called up to three times per
 * invoice line, and each call used to re-read and re-parse the overlay file.
 *
 * The cache turns over when the overlay file's mtime changes, and `writeOverlay`
 * clears it outright so that upsert-then-read inside one process — which is
 * what learn.ts does, and what the store test asserts — still sees its own write.
 */
interface TariffIndex {
  byCth: Map<string, TariffMaster>;
  ordered: TariffMaster[];
}

let tariffCache: { index: TariffIndex; stamp: number } | null = null;

function overlayStamp(): number {
  try {
    return statSync(overlayPath('tariff')).mtimeMs;
  } catch {
    return 0; // no overlay file yet
  }
}

function tariffIndex(): TariffIndex {
  const stamp = overlayStamp();
  if (tariffCache && tariffCache.stamp === stamp) return tariffCache.index;

  const byCth = new Map<string, TariffMaster>();
  // Lowest precedence first: each layer overwrites what the one beneath said.
  for (const row of tariffBookMasters()) byCth.set(row.cth, row);
  for (const row of TARIFF) {
    byCth.set(row.cth, { ...row, provenance: row.provenance ?? { source: 'seed' } });
  }
  for (const row of readOverlay('tariff')) byCth.set(row.cth, row);

  const index: TariffIndex = {
    byCth,
    ordered: [...byCth.values()].sort((a, b) => a.cth.localeCompare(b.cth)),
  };
  tariffCache = { index, stamp };
  return index;
}

/** One tariff row by exact CTH. O(1) over the whole First Schedule. */
export function tariffByCth(cth: string): TariffMaster | undefined {
  return tariffIndex().byCth.get(cth.replace(/\D/g, '').slice(0, 8));
}

export function allImporters(): ImporterMaster[] {
  const overlay = readOverlay('importers');
  const keys = new Set(overlay.map((i) => i.gstin || i.name));
  return [...overlay, ...IMPORTERS.filter((i) => !keys.has(i.gstin || i.name))];
}

/**
 * Every notified table, oldest first, with the operator's overlay on top.
 *
 * The overlay is the escape hatch for a fortnight ICEGATE has published but
 * this deployment predates: `fetch-eram.py` plus a rebuild is the normal route,
 * and keying the table on the masters screen is the one that does not need a
 * deploy. An overlay entry replaces the generated table for the same
 * `effectiveFrom` rather than sitting beside it.
 */
export function allExchangeRates(): ExchangeRateMaster[] {
  const overlay = readOverlay('exchangeRates');
  const dates = new Set(overlay.map((e) => e.effectiveFrom));
  return [
    ...GENERATED_EXCHANGE_RATES.filter((e) => !dates.has(e.effectiveFrom)),
    ...overlay,
  ].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function allProductMemory(): ProductMemory[] {
  return readOverlay('productMemory');
}

export function allPorts(): PortMaster[] {
  return PORTS;
}
export function allFtaSchemes(): FtaSchemeMaster[] {
  return FTA_SCHEMES;
}
export function allDeclarations(): DeclarationMaster[] {
  return DECLARATIONS;
}

/* ---------- mutations ---------- */

export function upsertTariff(row: TariffMaster): void {
  const overlay = readOverlay('tariff').filter((t) => t.cth !== row.cth);
  writeOverlay('tariff', [...overlay, row]);
}

export function upsertImporter(row: ImporterMaster): void {
  const key = row.gstin || row.name;
  const overlay = readOverlay('importers').filter((i) => (i.gstin || i.name) !== key);
  writeOverlay('importers', [...overlay, row]);
}

export function addExchangeRateTable(row: ExchangeRateMaster): void {
  const overlay = readOverlay('exchangeRates').filter((e) => e.effectiveFrom !== row.effectiveFrom);
  writeOverlay('exchangeRates', [...overlay, row]);
}

export function normalizeMemoryKeys(importerName: string, description: string): { importerKey: string; descriptionKey: string } {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const importerKey = norm(importerName)
    .replace(/\b(M\/?S|PVT|PRIVATE|LTD|LIMITED|LLP|CO|COMPANY|INC)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { importerKey, descriptionKey: norm(description).slice(0, 40) };
}

export function upsertProductMemory(entry: ProductMemory): void {
  const overlay = readOverlay('productMemory').filter(
    (m) => !(m.importerKey === entry.importerKey && m.descriptionKey === entry.descriptionKey),
  );
  writeOverlay('productMemory', [...overlay, entry]);
}

export function deleteProductMemory(importerKey: string, descriptionKey: string): void {
  writeOverlay(
    'productMemory',
    readOverlay('productMemory').filter((m) => !(m.importerKey === importerKey && m.descriptionKey === descriptionKey)),
  );
}

/** Find remembered tariff defaults for an importer + product description. */
export function recallProductMemory(importerName: string, description: string): ProductMemory | undefined {
  const { importerKey, descriptionKey } = normalizeMemoryKeys(importerName, description);
  const all = allProductMemory();
  return (
    all.find((m) => m.importerKey === importerKey && m.descriptionKey === descriptionKey) ??
    all.find(
      (m) =>
        m.importerKey === importerKey &&
        (m.descriptionKey.startsWith(descriptionKey.slice(0, 20)) || descriptionKey.startsWith(m.descriptionKey.slice(0, 20))),
    )
  );
}
