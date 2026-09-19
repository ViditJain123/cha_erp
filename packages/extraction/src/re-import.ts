import {
  reImportExclusion,
  reImportNotificationCandidates,
  type ReImportCandidate,
  type ReImportExportSchemeFlags,
  type ReImportPurpose,
} from '@checklist/core';
import type { DraftFlag, DraftItem, ItemReImport, ReImportCandidateSummary } from './draft.js';
import { similarity } from './packing.js';
import type { InvoiceDoc, ShippingBillExtract } from './schemas.js';

/**
 * Attaching a shipping bill to the lines that came back under it.
 *
 * A re-import is the one filing whose central fact is about a *different*
 * declaration, made months earlier by someone else: the shipping bill the goods
 * left India on. `docs/boe-mapping/09-re-import.md` is the contract for what
 * comes out of it.
 *
 * Two things this deliberately does not do. It does not choose the notification
 * entry — the bill's scheme flags routinely fit several entries of 45/2017, one
 * row carries one entry, and the choice is a person's. And it does not assume
 * the line that came back is the bill's first: `ex_job29`'s bill covers two
 * invoices and two items, of which one returned, so the serials are matched and
 * never defaulted.
 */

/**
 * How the documents announce goods coming back.
 *
 * Kept from the era before shipping bills were read, because it is still the
 * only signal on a job whose bill was not attached — and that case has to
 * block rather than file at the tariff rate.
 */
export const REIMPORT_DESCRIPTION =
  /\bre-?\s?import|\bmaterial\s+return|\breturn(?:ed|able|ble)\s+(?:goods|cargo|material)|\brejected\s+and\s+return/i;

/**
 * How much description overlap counts as the same goods.
 *
 * Lower than the packing list's 0.5, because the two documents here are further
 * apart than an invoice and a packing list: an export invoice describes goods
 * going out ("MECHANICALLY HULLED AUTODRIED SORTEXED SESAME SEEDS") and the
 * import line describes them coming back, usually with a "RE-IMPORT" prefix and
 * sometimes a different trade name. The HS code carries most of the weight.
 */
const MIN_SIMILARITY = 0.3;

/** A tie this close does not separate two lines. */
const TIE_EPSILON = 0.05;

interface ShippingBillLine {
  bill: ShippingBillExtract;
  sbInvSrNo: number;
  sbItemSrNo: number;
  hsCode?: string;
  description: string;
  quantity?: number;
}

export interface ReImportMatchResult {
  flags: DraftFlag[];
}

/**
 * Score one shipping-bill line against one import line, 0 to 1.
 *
 * The tariff heading is the strong signal and the description the weak one: an
 * eight-digit match is the same tariff item, a six-digit match is the same
 * subheading, and everything else rests on words that two documents spell
 * differently on purpose.
 */
function score(line: ShippingBillLine, item: DraftItem): number {
  const words = similarity(line.description, item.description);
  const a = (line.hsCode ?? '').replace(/\D/g, '');
  const b = item.ritc.replace(/\D/g, '');
  if (a && b) {
    if (a.slice(0, 8) === b.slice(0, 8) && a.length >= 8) return 0.7 + 0.3 * words;
    if (a.slice(0, 6) === b.slice(0, 6)) return 0.5 + 0.3 * words;
    // Different subheadings are different goods, whatever the words say.
    return Math.min(words, 0.25);
  }
  return words;
}

/** Every goods line of every invoice of every shipping bill on the job. */
function linesOf(bills: ShippingBillExtract[]): ShippingBillLine[] {
  const out: ShippingBillLine[] = [];
  for (const bill of bills) {
    bill.invoices?.forEach((invoice, i) => {
      invoice.items?.forEach((item, k) => {
        if (!item.description?.trim()) return;
        out.push({
          bill,
          // The bill's own serials. Falling back to position is a last resort
          // for a bill whose numbering did not extract — never a renumbering.
          sbInvSrNo: invoice.sbInvSrNo ?? i + 1,
          sbItemSrNo: item.sbItemSrNo ?? k + 1,
          ...(item.hsCode ? { hsCode: item.hsCode } : {}),
          description: item.description,
          ...(item.quantity != null ? { quantity: item.quantity } : {}),
        });
      });
    });
  }
  return out;
}

/** The flags as the candidate list stores them on the draft. */
function summarise(candidates: ReImportCandidate[]): ReImportCandidateSummary[] {
  return candidates.map((c) => ({
    notification: c.entry.notification,
    serial: c.entry.serial,
    description: c.entry.description,
    amountPayable: c.entry.amountPayable,
    because: c.because,
    cautions: c.cautions,
    needsExportFreightInsurance: c.entry.exportFreightInsurance === 'required',
    needsIncentiveRepayment: c.entry.incentiveRepayment === 'required',
  }));
}

/**
 * The bill's Part-I flag row, as the candidate resolver wants it.
 *
 * `null` means the box could not be read and is dropped rather than turned into
 * `false`: "the export claimed no drawback" and "we could not see the drawback
 * box" lead to different notification entries.
 */
function schemeFlags(bill: ShippingBillExtract): ReImportExportSchemeFlags {
  const f = bill.schemeFlags;
  const out: ReImportExportSchemeFlags = {};
  if (f?.drawback != null) out.drawback = f.drawback;
  if (f?.rodtep != null) out.rodtep = f.rodtep;
  if (f?.meis != null) out.meis = f.meis;
  if (f?.licence != null) out.licence = f.licence;
  if (f?.dfrc != null) out.dfrc = f.dfrc;
  if (f?.lut != null) out.lut = f.lut;
  return out;
}

/**
 * Attach the shipping bill each re-imported line went out under.
 *
 * Mutates `items`, in the way the unit and Single Window passes in `merge.ts`
 * already do, and returns what the reviewer needs to hear.
 */
export function attachReImport(
  items: DraftItem[],
  bills: ShippingBillExtract[],
  exportInvoices: InvoiceDoc[],
  opts: { beFilingDate?: string; purpose?: ReImportPurpose } = {},
): ReImportMatchResult {
  const flags: DraftFlag[] = [];
  const lines = linesOf(bills);

  // ---- no shipping bill, but the goods read as a return ----
  // The case the old blanket blocker existed for, and it still has to stop the
  // filing: with the full tariff behind it the line comes out at the statutory
  // rate — sesame at 30% on ex_job3 — with nothing to say the duty is almost
  // certainly not payable.
  if (bills.length === 0) {
    items.forEach((item, idx) => {
      if (!REIMPORT_DESCRIPTION.test(item.description)) return;
      flags.push({
        severity: 'error',
        path: `items.${idx}.reImport`,
        message:
          `"${item.description.slice(0, 60)}" reads as a re-import, and no shipping bill is on the ` +
          'job. The exemption these goods come back under — 45/2017, 46/2017, 94/96 or 158/95 — ' +
          'turns on how they left India, which only the shipping bill says. Ask the importer for ' +
          'it; without one the line is filed at the full tariff rate.',
      });
    });
    return { flags };
  }

  // ---- match each bill's lines to the lines on this Bill of Entry ----
  const pairs = lines
    .flatMap((line) => items.map((item) => ({ line, item, s: score(line, item) })))
    .filter((p) => p.s >= MIN_SIMILARITY)
    .sort((a, b) => b.s - a.s);

  const takenItems = new Set<DraftItem>();
  const takenLines = new Set<ShippingBillLine>();
  for (const pair of pairs) {
    if (takenItems.has(pair.item) || takenLines.has(pair.line)) continue;
    // A tie between two shipping-bill lines for the same import line is not a
    // match: the wrong SB item serial sends Customs to the wrong export.
    const rival = pairs.find(
      (p) => p !== pair && p.item === pair.item && !takenLines.has(p.line) && pair.s - p.s < TIE_EPSILON,
    );
    if (rival) {
      flags.push({
        severity: 'warning',
        path: `items.${items.indexOf(pair.item)}.reImport`,
        message:
          `"${pair.item.description.slice(0, 50)}" matches two lines of shipping bill ` +
          `${pair.line.bill.sbNo} equally well — item ${pair.line.sbItemSrNo} and item ` +
          `${rival.line.sbItemSrNo}. Pick the one that came back on the job screen.`,
      });
      takenItems.add(pair.item);
      continue;
    }
    takenItems.add(pair.item);
    takenLines.add(pair.line);
    pair.item.reImport = blockFor(pair.line, opts);
  }

  // ---- lines the bill does not account for ----
  for (const [idx, item] of items.entries()) {
    if (item.reImport || !REIMPORT_DESCRIPTION.test(item.description)) continue;
    flags.push({
      severity: 'error',
      path: `items.${idx}.reImport`,
      message:
        `"${item.description.slice(0, 60)}" reads as a re-import, but no line of shipping bill ` +
        `${bills.map((b) => b.sbNo).join(' or ')} matches it. Customs matches the returning line ` +
        'against the export by the shipping bill’s own invoice and item serials — set them on the ' +
        'job screen, or confirm this line is not a re-import.',
    });
  }

  // ---- the export invoice, for the amounts nobody else states ----
  if (exportInvoices.length && items.some((i) => i.reImport)) {
    flags.push({
      severity: 'info',
      path: 'items.reImport',
      message:
        `Export invoice ${exportInvoices.map((i) => i.invoiceNumber).join(', ')} is on the job and ` +
        'is not filed as an invoice of this Bill of Entry. It is where the drawback, RoDTEP or ' +
        'IGST-refund figures are printed, which is what the re-import entry may have to repay.',
    });
  }

  return { flags };
}

/** One line's re-import block: the bill's facts, plus what it could be claiming. */
function blockFor(
  line: ShippingBillLine,
  opts: { beFilingDate?: string; purpose?: ReImportPurpose },
): ItemReImport {
  const bill = line.bill;
  const candidates = reImportNotificationCandidates({
    ...(bill.sbDate ? { sbDate: bill.sbDate } : {}),
    ...(bill.leoDate ? { leoDate: bill.leoDate } : {}),
    ...(opts.beFilingDate ? { beDate: opts.beFilingDate } : {}),
    ...(bill.countryOfFinalDestination
      ? { destinationCountry: bill.countryOfFinalDestination }
      : {}),
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
    schemeFlags: schemeFlags(bill),
  });
  const exclusion = reImportExclusion(opts.purpose ? { purpose: opts.purpose } : {});

  return {
    sbNo: { value: bill.sbNo, source: 'document' },
    sbDate: { value: bill.sbDate ?? '', source: 'document' },
    portOfExport: { value: bill.portCode ?? '', source: 'document' },
    sbInvSrNo: { value: line.sbInvSrNo, source: 'document' },
    sbItemSrNo: { value: line.sbItemSrNo, source: 'document' },
    candidates: summarise(candidates),
    ...(opts.purpose ? { purpose: opts.purpose } : {}),
    ...(exclusion ? { exclusion } : {}),
  };
}
