import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DECLARATIONS,
  EXCHANGE_RATES,
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
}

/* ---------- merged reads (overlay wins on key collision) ---------- */

export function allTariff(): TariffMaster[] {
  const overlay = readOverlay('tariff');
  const overlayCths = new Set(overlay.map((t) => t.cth));
  return [...overlay, ...TARIFF.filter((t) => !overlayCths.has(t.cth))];
}

export function allImporters(): ImporterMaster[] {
  const overlay = readOverlay('importers');
  const keys = new Set(overlay.map((i) => i.gstin || i.name));
  return [...overlay, ...IMPORTERS.filter((i) => !keys.has(i.gstin || i.name))];
}

export function allExchangeRates(): ExchangeRateMaster[] {
  const overlay = readOverlay('exchangeRates');
  const dates = new Set(overlay.map((e) => e.effectiveFrom));
  return [...EXCHANGE_RATES.filter((e) => !dates.has(e.effectiveFrom)), ...overlay].sort((a, b) =>
    a.effectiveFrom.localeCompare(b.effectiveFrom),
  );
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
