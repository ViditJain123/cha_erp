import { loadTariffBookFile } from './tariff-book.js';

/**
 * The ITCHS standard unit of quantity for a CTH — the "SUQC".
 *
 * ICES asks for it on **every line of every Bill of Entry**, in the Single
 * Window table (BE Message format 2.25, CACHI01 Part 19/24):
 *
 * > The following values needs to declared in the Single Window Declaration for
 * > every item for SUQC — Info_type: `CHR`, Info_Qualifier: `SQC`, Info_msr: to
 * > be declared as per tariff UQC, **Info_uqc: UQC declared should be as that of
 * > UQC in ITCHS for that CTH**.
 *
 * It is emphatically **not** the invoice unit. `84051090` and `88022000` are
 * `u` in the tariff, and the four Bills of Entry in the corpus that carry them
 * file `NOS` while their invoices say `SET` and `UNT`. Filing the invoice unit
 * here is ICES **494** (*SUQC wrong from the CTH/item*).
 *
 * Built by `packages/core/scripts/build-standard-uqc.py`, which documents why
 * this is a master of its own and not `lookupTariff().unit`: the tariff book is
 * an OCR'd scan that loses the superscript in `m2`/`m3`, and maps `m2` to
 * `MTS` — the UQC for a *metric tonne*. CBIC's own First Schedule wins; the
 * book only fills its holes, and never with a token the superscript bug could
 * have produced.
 *
 * Contract: docs/boe-mapping/11-sw-addl-info.md.
 */
export interface StandardUqcFile {
  builtAt: string;
  sources: { schedule: string; book: string };
  count: number;
  fromSchedule: number;
  fromBook: number;
  bookDisagreements: number;
  bookRefused: number;
  /** CTHs neither source gives a unit for. A line on one of these cannot be filed. */
  noUnit: string[];
  rows: Record<string, string>;
}

let file: StandardUqcFile | null | undefined;

export function standardUqcFile(): StandardUqcFile | null {
  if (file === undefined) {
    file = loadTariffBookFile<StandardUqcFile>('standard-uqc.json');
    if (!file && process.env.NODE_ENV === 'production') {
      console.error(
        '[standard-uqc] standard-uqc.json is missing from this deployment. Every export will ' +
          'block on SW_ADDL_INFO. Check outputFileTracingIncludes in apps/web/next.config.ts, ' +
          'or set TARIFF_BOOK_DIR.',
      );
    }
  }
  return file;
}

/**
 * The standard UQC for a CTH, or `undefined` when the tariff gives none.
 *
 * `undefined` is a real answer and must be treated as one: 338 tariff items
 * have no unit in either source, and the export blocks rather than guessing.
 * There is no safe default for a unit that multiplies a declared quantity.
 */
export function standardUqcForCth(cth: string | undefined): string | undefined {
  if (!cth) return undefined;
  const digits = cth.replace(/\D/g, '');
  if (digits.length !== 8) return undefined;
  return standardUqcFile()?.rows[digits];
}

/**
 * Units that mean "a count of things", across the invoice and the tariff.
 *
 * A line invoiced in `SET`, `UNT`, `PCS` or `NOS` against a CTH whose standard
 * unit is `NOS` needs no arithmetic — the number is already the number of
 * articles, and only its name changes. This is the *only* conversion any
 * filing in the corpus exercises; everything else is refused.
 */
const COUNT_UNITS = new Set(['NOS', 'UNT', 'PCS', 'PC', 'SET', 'SETS', 'EA', 'EACH', 'U', 'UNITS']);

export type StandardQuantity =
  | { ok: true; quantity: number; uqc: string }
  | { ok: false; reason: string };

/**
 * A line's quantity restated in its CTH's standard unit.
 *
 * Refuses rather than approximates. Nothing in the system holds a density, a
 * pack size or a sheet thickness, so weight-to-count and anything through an
 * area or a volume has no answer — and a wrong SUQC quantity is a misdeclared
 * quantity, not a cosmetic defect.
 *
 * `weightToKg` is passed in rather than imported so this module stays free of
 * the code masters, which import the tariff book in turn.
 */
export function standardQuantity(
  cth: string | undefined,
  quantity: number | undefined,
  invoiceUnit: string | undefined,
  toKg: (value: number, unit: string) => number | undefined,
): StandardQuantity {
  const uqc = standardUqcForCth(cth);
  if (!uqc)
    return {
      ok: false,
      reason: `the tariff gives no standard unit for CTH ${cth ?? '(none)'}`,
    };
  if (quantity === undefined || quantity === null || !Number.isFinite(quantity))
    return { ok: false, reason: 'the line has no quantity' };

  const from = (invoiceUnit ?? '').trim().toUpperCase();
  if (!from) return { ok: false, reason: 'the line has no unit' };
  if (from === uqc) return { ok: true, quantity, uqc };

  if (COUNT_UNITS.has(from) && uqc === 'NOS') return { ok: true, quantity, uqc };

  if (uqc === 'KGS' || uqc === 'GMS' || uqc === 'TON') {
    const kg = toKg(quantity, from);
    if (kg === undefined)
      return { ok: false, reason: `no conversion from ${from} to ${uqc}` };
    const converted = uqc === 'KGS' ? kg : uqc === 'GMS' ? kg * 1000 : kg / 1000;
    return { ok: true, quantity: converted, uqc };
  }

  return { ok: false, reason: `no conversion from ${from} to ${uqc}` };
}
