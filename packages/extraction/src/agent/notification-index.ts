import { readFileSync } from 'node:fs';
import path from 'node:path';
import { logisysNotn } from '@checklist/core';

/**
 * The CBIC notification index — every notification's number, title, category
 * and date — as a lookup the agent can call.
 *
 * `data/customs-corpus/index/cbic-notifications.json` has sat in the repo for
 * the build scripts and nothing read it at runtime. It answers the question
 * the model most often has to guess at: does a notification with this number
 * exist, what is it called, and is it still in force. A title is not a text —
 * the text is in the library — but a model that can check a number against a
 * title cannot invent one.
 */
export interface NotificationIndexRow {
  notificationNo: string;
  /** The ICES form, "045/2025", for the Customs tariff series; null for others. */
  ices: string | null;
  name: string;
  category: string;
  date: string | null;
  amended: boolean;
  omitted: boolean;
}

interface RawRow {
  notificationNo?: string | null;
  notificationName?: string | null;
  notificationCategory?: string | null;
  notificationDt?: string | null;
  isAmended?: string | null;
  isOmitted?: string | null;
}

const INDEX_FILE = 'data/customs-corpus/index/cbic-notifications.json';

function candidatePaths(): string[] {
  const out: string[] = [];
  const override = process.env.CUSTOMS_CORPUS_DIR;
  if (override) out.push(path.join(override, 'index', 'cbic-notifications.json'));
  let dir = process.cwd();
  for (let depth = 0; depth < 10; depth++) {
    out.push(path.join(dir, INDEX_FILE));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
}

let rows: NotificationIndexRow[] | null | undefined;

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 3);
}

/** The index, loaded once; null when the corpus is not on this machine. */
export function notificationIndex(): NotificationIndexRow[] | null {
  if (rows !== undefined) return rows;
  rows = null;
  for (const candidate of candidatePaths()) {
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as RawRow[];
      rows = raw
        .filter((r) => r.notificationNo)
        .map((r) => {
          const no = String(r.notificationNo).trim();
          // Only the Customs tariff series files as NNN/YYYY on a Bill of
          // Entry; IGST and cess series carry their own suffixes.
          const isCus = /^\d{1,3}\/\d{4}-\s*Cus(toms)?$/i.test(no);
          return {
            notificationNo: no,
            ices: isCus ? (logisysNotn(no.replace(/-.*$/, '')) ?? null) : null,
            name: (r.notificationName ?? '').replace(/\s+/g, ' ').trim(),
            category: r.notificationCategory ?? '',
            date: r.notificationDt ? r.notificationDt.slice(0, 10) : null,
            amended: r.isAmended === 'Y',
            omitted: r.isOmitted === 'Y',
          };
        });
      break;
    } catch {
      // next candidate
    }
  }
  return rows;
}

export function resetNotificationIndex(): void {
  rows = undefined;
}

/**
 * Rows for a number ("45/2025", "021/2023", "9/2025-IT(R)") or a title query.
 *
 * A number matches every series carrying it — 45/2025 is a Customs tariff
 * notification and a non-tariff one — so the caller sees the category and
 * picks. A query is a token match over titles, best first.
 */
export function lookupNotifications(args: { number: string | null; query: string | null }, limit = 8): NotificationIndexRow[] {
  const index = notificationIndex();
  if (!index) return [];
  const out: NotificationIndexRow[] = [];
  if (args.number) {
    const raw = args.number.trim();
    const bare = raw.replace(/-.*$/, '').trim();
    const ices = logisysNotn(bare);
    const wantSeries = raw.includes('-') ? raw.slice(raw.indexOf('-') + 1).toLowerCase().replace(/[^a-z]/g, '') : null;
    for (const row of index) {
      const rowBare = row.notificationNo.replace(/-.*$/, '').trim();
      if (logisysNotn(rowBare) !== ices) continue;
      if (wantSeries) {
        const series = row.notificationNo.slice(row.notificationNo.indexOf('-') + 1).toLowerCase().replace(/[^a-z]/g, '');
        if (!series.startsWith(wantSeries.slice(0, 3))) continue;
      }
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  if (args.query && out.length < limit) {
    const want = tokens(args.query);
    if (want.length) {
      const scored = index
        .map((row) => {
          const have = new Set(tokens(row.name));
          const hits = want.filter((t) => have.has(t)).length;
          return { row, score: hits / want.length };
        })
        .filter((s) => s.score >= 0.5 && !out.includes(s.row))
        .sort((a, b) => b.score - a.score || (b.row.date ?? '').localeCompare(a.row.date ?? ''));
      for (const s of scored) {
        out.push(s.row);
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}
