import { mergeContainerLists } from './containers.js';
import {
  declarationStatements,
  declarationTexts,
  bcdExemptionMatches,
  bcdExemptionNotification,
  compCessForCth,
  compCessNotification,
  isInForce,
  isValidContainerNumber,
  chaProfile,
  computeBeDuty,
  exchangeRatesOn,
  formatForeignPort,
  igstRateForCth,
  lookupForeignPort,
  lookupForeignPortLoose,
  lookupAirline,
  lookupTariff,
  lookupTariffByPrefix,
  resolveTariffPrefix,
  NATURE_OF_TRANSACTION,
  normalizePackageUnit,
  normalizeUqc,
  normalizeWeightUnit,
  recallProductMemory,
  resolveIndianStation,
  type StationKind,
  singleWindowRuleForChapter,
  transportModeForStation,
  tradeDescription,
  validateGstin,
  weightToKg,
  type TermsOfInvoice,
  tariffDissent,
  tariffEdition,
  tariffBookNotification,
  IGST_RATE_NOTIFICATION,
} from '@checklist/core';
import { singleWindowRowsForItem } from './single-window.js';
import type {
  AwbExtract,
  BankCertificateExtract,
  BlExtract,
  CoaExtract,
  ContractExtract,
  CooExtract,
  ExtractedDoc,
  FreightCertificateExtract,
  HighSeasAgreementExtract,
  InsuranceCertificateExtract,
  InvoiceDoc,
  InvoiceExtract,
  PackingListExtract,
  PurchaseOrderExtract,
  ShippingBillExtract,
} from './schemas.js';
import {
  toInvoiceInputs,
  type ChecklistDraft,
  type DraftBatch,
  type DraftFlag,
  type DraftInvoice,
  type DraftItem,
  type FieldMeta,
  type HssParty,
} from './draft.js';
import { attachPacking } from './packing.js';
import { attachReImport } from './re-import.js';
import { resolveItems } from './items-resolve.js';

/**
 * How the documents announce goods coming back: "Re-import of Mechanically
 * Hulled ... Sesame" (ex_job3), "(MATERIAL RETURN VIDE ..." and "REJECTED AND
 * RETURNBLE CARGO" (ex_job4, spelling and all). Deliberately narrow — "return"
 * alone appears in valve and conveyor names — because a false positive blocks
 * an ordinary import.
 */
const REIMPORT =
  /\bre-?\s?import|\bmaterial\s+return|\breturn(?:ed|able|ble)\s+(?:goods|cargo|material)|\brejected\s+and\s+return/i;

function pick<T>(docs: ExtractedDoc[], type: string): T | undefined {
  const d = docs.find((x) => x.docType === type && x.data);
  return d?.data as T | undefined;
}

/**
 * Every document of a type, not just the first.
 *
 * A job can legitimately carry two bills of lading — the carrier's master and
 * the forwarder's house — and since one PDF can now yield several documents,
 * a bundled scan can produce both from one attachment. Taking the first and
 * dropping the rest is how a master B/L gets lost behind a house one.
 */
function pickAll<T>(docs: ExtractedDoc[], type: string): T[] {
  return docs.filter((x) => x.docType === type && x.data).map((x) => x.data as T);
}
function fileOf(docs: ExtractedDoc[], type: string): string | undefined {
  return docs.find((x) => x.docType === type && x.data)?.fileName;
}

function normalizeToi(t: InvoiceDoc['termsOfInvoice']): TermsOfInvoice {
  switch (t) {
    case 'CFR':
      return 'C&F';
    case 'CPT':
    case 'UNKNOWN':
      return 'C&F';
    default:
      return t;
  }
}

/**
 * The place named after the Incoterm — ICES field 76, "Terms Place".
 *
 * "CIF NHAVA SHEVA" names Nhava Sheva; "Ex-Works Taunton, MA" names Taunton.
 * Returns nothing when the invoice prints the term alone, which is the common
 * case, rather than inventing a port from the shipment.
 */
function termsPlaceOf(doc: InvoiceDoc): string | undefined {
  const raw = doc.deliveryTermsRaw?.trim();
  if (!raw) return undefined;
  const withoutTerm = raw.replace(
    /^\s*(cost[,\s]+insurance\s*(and|&)?\s*freight|cost\s*(and|&)\s*freight|ex[-\s]?works|free\s+on\s+board|carriage\s+paid\s+to|c\s*&\s*f|cif|cfr|cnf|c\s*&\s*i|fob|exw|cpt|cip|fca|dap|ddp|dpu)\b[\s:,-]*/i,
    '',
  );
  const place = withoutTerm.trim().replace(/^[,\s-]+|[,\s-]+$/g, '');
  return place && place.toLowerCase() !== raw.toLowerCase() ? place : undefined;
}

/**
 * Do two documents quote the same reference?
 *
 * Compared without spaces, punctuation or case, because a freight certificate
 * quoting "ASI EP061126-1" and an invoice numbered "ASI-EP061126/1" are the
 * same document to everyone but a string comparison.
 */
function sameRef(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const key = (v: string) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return key(a) === key(b) && key(a).length > 0;
}

/**
 * A charge in another currency, expressed in the invoice's.
 *
 * ICES takes the miscellaneous-charge column in the invoice currency (BE
 * Message format 2.25, MISC_CH), and a freight certificate routinely bills the
 * ex-works leg in a third one. Converts through the rupee at the customs rates
 * for the filing date; returns nothing when either leg has no rate, so the
 * caller reports it rather than adding numbers that are not comparable.
 */
function convertTo(
  amount: { amount: number; currency: string },
  target: string,
  rates: Record<string, number>,
): number | undefined {
  if (amount.currency === target) return amount.amount;
  const from = amount.currency === 'INR' ? 1 : rates[amount.currency];
  const to = target === 'INR' ? 1 : rates[target];
  if (!from || !to) return undefined;
  return (amount.amount * from) / to;
}

/** The Logi-Sys dropdown label for what the invoice says the transaction is. */
function natureOfTransactionFor(doc: InvoiceDoc): string {
  return NATURE_OF_TRANSACTION[doc.natureOfTransaction] ?? NATURE_OF_TRANSACTION.SALE!;
}

const nearlyEqual = (a: number, b: number, tolerance = 0.02) =>
  Math.abs(a - b) <= tolerance * Math.max(a, b);

/**
 * Pull the voyage number off the end of a vessel/voyage string.
 *
 * B/Ls state the two together in whatever shape the line prefers —
 * "INTERASIA TENACITY S022", "WADI DUKA/02621/N", "MSC ARUSHI V.FQ525A". The
 * BE wants them in separate columns.
 *
 * Returns undefined when the tail does not look like a voyage, which leaves
 * vesselOrFlight intact and the voyage column blank. A blank cell a human
 * fills in beats a vessel name silently truncated.
 */
function splitVoyage(vesselVoyage: string): string | undefined {
  const trimmed = vesselVoyage.trim();
  if (!trimmed) return undefined;

  // Slash-delimited: "WADI DUKA/02621/N" -> "02621/N"
  const slash = trimmed.split('/');
  if (slash.length > 1) {
    const tail = slash.slice(1).join('/').trim();
    return tail || undefined;
  }

  // Space-delimited: the last token counts as a voyage only when it mixes
  // digits in, so "MAERSK KOWLOON" does not lose "KOWLOON".
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return undefined;
  const last = tokens.at(-1)!;
  const voyageShaped = /\d/.test(last) && /^[A-Z0-9.\-]{2,10}$/i.test(last);
  return voyageShaped ? last.replace(/^V\./i, '') : undefined;
}

/**
 * One document's opinion about a field: which file said it, and what it said.
 *
 * `source` is a file name and may be undefined, which is how "this document
 * type was not in the folder" is expressed without the caller branching.
 */
interface Candidate<T> {
  source: string | undefined;
  value: T | null | undefined;
}

/**
 * The first document that has an opinion wins, and every disagreement is named.
 *
 * This is the generalisation of the gross-weight block that used to be the only
 * field doing it properly. The pattern matters more than the precedence: a
 * SHIPMENT value present on *any* document should reach the sheet, and when two
 * documents disagree the operator needs to be told which said what rather than
 * handed the winner silently.
 *
 * `equal` decides what counts as a disagreement — weights compare with a
 * tolerance, identifiers compare as normalised strings — so that "100400" and
 * "100400.0" on two documents do not raise a flag nobody can act on.
 */
function reconcile<T>(
  path: string,
  label: string,
  candidates: Candidate<T>[],
  ctx: {
    flags: DraftFlag[];
    fieldMeta: Record<string, FieldMeta>;
    equal?: (a: T, b: T) => boolean;
    format?: (value: T) => string;
    /** Raise the conflict as a warning rather than info. Default true. */
    warnOnConflict?: boolean;
    /**
     * What counts as the document having said something.
     *
     * The default accepts anything non-null and non-empty. Weights and counts
     * pass `positive` instead: a bill of lading that returns `netWeightKg: 0`
     * has not stated a net weight of nothing, it has failed to state one — and
     * without this, that zero outranks the packing list's real figure because
     * the B/L is first in the precedence order.
     */
    stated?: (value: T) => boolean;
    /**
     * Whether a reading could be true at all.
     *
     * Precedence decides between documents that disagree; this decides against
     * one that cannot be right. `ex_job25`'s invoice states its net weight
     * three times — 49,500,000 kg once and 49,500 kg twice — against a gross of
     * 50,688 kg, and precedence alone filed the impossible one: 49,500 tonnes
     * of polypropylene in two containers, flagged as "one of the two is
     * misread" and declared anyway.
     *
     * An implausible reading is not discarded — it still wins when every
     * reading is implausible, because then the check is what is wrong — but it
     * loses to any reading that holds up, and the flag says which was dropped.
     */
    plausible?: (value: T) => boolean;
  },
): T | undefined {
  const isStated = ctx.stated ?? ((v: T) => v !== ('' as unknown as T));
  const stated = candidates.filter(
    (c): c is { source: string; value: T } =>
      c.source != null && c.value != null && isStated(c.value),
  );
  if (!stated.length) return undefined;

  const holdsUp = ctx.plausible;
  const plausible = holdsUp ? stated.filter((c) => holdsUp(c.value)) : stated;
  const winner = (plausible.length ? plausible : stated)[0]!;
  if (holdsUp && plausible.length && plausible.length < stated.length) {
    const fmt = ctx.format ?? ((v: T) => String(v));
    ctx.flags.push({
      severity: 'warning',
      path,
      message:
        `${label}: ${stated
          .filter((c) => !holdsUp(c.value))
          .map((c) => `${fmt(c.value)} (${c.source})`)
          .join(', ')} cannot be right for this consignment, so ${fmt(winner.value)} ` +
        `from ${winner.source} was used. Check the document.`,
    });
  }
  const equal = ctx.equal ?? ((a: T, b: T) => a === b);
  const format = ctx.format ?? ((v: T) => String(v));
  const conflicts = stated.slice(1).filter((c) => !equal(c.value, winner.value));

  if (conflicts.length) {
    // "across documents" is a lie when two fields of one form disagree — a B/L
    // whose Carrier box and letterhead differ is one document, not two.
    const sources = new Set(stated.map((c) => c.source));
    ctx.flags.push({
      severity: ctx.warnOnConflict === false ? 'info' : 'warning',
      path,
      message:
        `${label} ${sources.size > 1 ? 'differs across documents' : `is stated more than once on ${winner.source}`}: ` +
        stated
          .map((c) => (sources.size > 1 ? `${format(c.value)} (${c.source})` : format(c.value)))
          .join(', ') +
        `. Using ${format(winner.value)}${sources.size > 1 ? ` from ${winner.source}` : ''}.`,
    });
    ctx.fieldMeta[path] = {
      confidence: 'low',
      sources: stated.map((c) => c.source),
      conflicts: conflicts.map((c) => ({ source: c.source, value: format(c.value) })),
    };
  }
  return winner.value;
}

/**
 * The rule Logi-Sys prints between the master and house waybill numbers in
 * Marks & Nos on an air Bill of Entry. Sixteen dots, counted off the checklists
 * for jobs I-13841/26-27 and I-30239/26-27, which print it identically.
 */
const AIR_MARKS_RULE = '................';

/**
 * What a document actually states, or nothing.
 *
 * Models occasionally answer a "return null when absent" instruction with the
 * *text* "null" — a live eval run put the literal string "/null" into a house
 * air waybill number, and a corpus run put ">null" into the importer's name and
 * the bill of lading's place of delivery. Placeholders a person writes ("N/A",
 * "NIL", "-") fail the same way: they are the document saying there is nothing,
 * and nothing is what should reach the sheet.
 *
 * It guarded the document numbers alone for a while, which is how ">null"
 * reached a party name — the one field on a Bill of Entry that Logi-Sys keys
 * the importer on, and which no later step could tell from a real name.
 */
function meaningful(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const bare = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!bare) return undefined;
  return ['NULL', 'NA', 'NIL', 'NONE', 'UNDEFINED', 'NOTAPPLICABLE'].includes(bare)
    ? undefined
    : trimmed;
}

/**
 * A date a document states, in ISO form, or nothing.
 *
 * The same placeholder problem as `meaningful()`, one step further: a model
 * that answers "null" in text answers it in a *date* field too, and a date is
 * the one kind of value where the junk is not obviously junk downstream. A
 * corpus run put "/null" into an invoice date, where it survived as far as the
 * exported file's name. Anything that is not `YYYY-MM-DD` is dropped, so a
 * missing date reads as missing and reaches the checks that care.
 */
function statedDate(value: string | null | undefined): string | undefined {
  const text = meaningful(value);
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  return Number.isNaN(new Date(text).getTime()) ? undefined : text;
}

/** Case- and punctuation-insensitive comparison, for identifiers off two documents. */
function sameIdentifier(a: string, b: string): boolean {
  const key = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key(a) === key(b);
}

/**
 * Deterministic merge of per-document extractions into a reviewable checklist
 * draft: reconcile overlapping fields, enrich from masters, compute duty.
 *
 * Source-of-truth rules (from the operator's hand notes):
 *   importer name & port of loading <- BL/AWB; country of origin <- COO;
 *   invoice no/date, TOI, terms of payment, description & HSN <- invoice;
 *   duty/GST/single-window data <- masters.
 */
export function mergeToDraft(docs: ExtractedDoc[], opts?: { today?: string }): ChecklistDraft {
  const flags: DraftFlag[] = [];
  const fieldMeta: Record<string, FieldMeta> = {};
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);

  // Every invoice on the job, in the order the documents print them. One file
  // can hold a dozen (`ex_job5`), and a job can carry several files, so both
  // levels flatten. Deduplicated on the invoice number because the same
  // invoice is routinely bound twice — once on its own, once beside the
  // packing list — and two rows for one invoice is a wrong Bill of Entry.
  //
  // An invoice running in the export direction is not one of them. A re-import
  // job attaches the original export invoice beside the supplier's invoice for
  // the goods coming in — `ex_job29` has both — and Logi-Sys files one invoice,
  // not two. The export invoice is kept for the re-import block, which is where
  // its drawback and RoDTEP declarations belong.
  const invoiceDocs: InvoiceDoc[] = [];
  const exportInvoiceDocs: InvoiceDoc[] = [];
  for (const extract of pickAll<InvoiceExtract>(docs, 'invoice')) {
    for (const one of extract.invoices ?? []) {
      if (one.isExportInvoice) {
        exportInvoiceDocs.push(one);
        continue;
      }
      const key = one.invoiceNumber.replace(/\s+/g, '').toUpperCase();
      const seen = invoiceDocs.find((x) => x.invoiceNumber.replace(/\s+/g, '').toUpperCase() === key);
      if (seen) {
        // A continuation sheet read as its own invoice: keep the lines, not a
        // second declaration.
        if (one.items.length && !seen.items.length) seen.items.push(...one.items);
        continue;
      }
      invoiceDocs.push(one);
    }
  }
  // The header's invoice. Ports, weights, the seller and the country of origin
  // are properties of the consignment, not of one invoice in it, and every
  // golden states them identically on all of them.
  const inv = invoiceDocs[0];
  // The master bill of lading is the one the Bill of Entry declares, so when a
  // job carries both it is the one that drives the draft. The house B/L is kept
  // separately and fills only the house columns.
  const allBls = pickAll<BlExtract>(docs, 'bill_of_lading');
  const bl = allBls.find((b) => !b.isHouseBl) ?? allBls[0];
  const houseBl = allBls.find((b) => b.isHouseBl && b !== bl);
  const allAwbs = pickAll<AwbExtract>(docs, 'air_waybill');
  const awb = allAwbs.find((a) => a.hawbNumber == null || a.mawbNumber != null) ?? allAwbs[0];
  const coo = pick<CooExtract>(docs, 'certificate_of_origin');
  const coa = pick<CoaExtract>(docs, 'certificate_of_analysis');
  const pl = pick<PackingListExtract>(docs, 'packing_list');

  if (!inv) flags.push({ severity: 'error', message: 'No commercial invoice found — invoice is mandatory.' });
  if (!bl && !awb)
    flags.push({ severity: 'error', message: 'No transport document (BL/AWB) found — required for BE.' });

  // ---- Transport mode: S, A or L ----
  //
  // Air is settled by the air waybill. Sea is not settled by the bill of lading
  // alone: a consignment railed to an inland container depot is filed as `L`
  // however it crossed the ocean, and the only place that is stated is the
  // BL's place of final delivery. So the delivery place is resolved against the
  // custom house master and the *station* decides.
  //
  // The place, and what kind of station the document it came off can be. A
  // place of final delivery is either — a consignment delivered inland reads
  // "ICD TUMB" — so it carries no hint; a port of discharge is a sea station
  // and an airport of destination an air one, which is what tells "KOLKATA"
  // off a bill of lading from the airport and the ICD of the same name.
  //
  // A place of delivery that repeats the port of discharge is the port: the
  // consignment is not going on anywhere, so it is the sea station and not the
  // ICD of the same name. `ex_job13` prints "KOLKATA" in both boxes, which
  // names a sea port, an air cargo complex and an ICD, and stayed unresolved.
  const deliveryPlaceRaw = meaningful(bl?.placeOfDelivery);
  const dischargePlaceRaw = meaningful(bl?.portOfDischarge);
  const bare = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sameBox =
    deliveryPlaceRaw && dischargePlaceRaw
      ? bare(deliveryPlaceRaw) === bare(dischargePlaceRaw) ||
        bare(deliveryPlaceRaw).startsWith(bare(dischargePlaceRaw)) ||
        bare(dischargePlaceRaw).startsWith(bare(deliveryPlaceRaw))
      : false;
  const delivery: [string | undefined, StationKind | undefined] = deliveryPlaceRaw
    ? [deliveryPlaceRaw, sameBox ? 'sea' : undefined]
    : dischargePlaceRaw
      ? [dischargePlaceRaw, 'sea']
      : [meaningful(awb?.airportOfDestination), 'air'];
  const deliveryPlace = delivery[0];
  const deliveryStation = deliveryPlace ? resolveIndianStation(deliveryPlace, delivery[1]) : undefined;
  const deliveryMode = deliveryStation ? transportModeForStation(deliveryStation) : undefined;

  const transportMode: ChecklistDraft['transportMode'] = awb
    ? 'Air'
    : deliveryMode === 'L'
      ? 'Land'
      : 'Sea';

  if (bl && deliveryPlace && !deliveryStation) {
    flags.push({
      severity: 'warning',
      path: 'transportMode',
      message:
        `Place of delivery "${deliveryPlace}" did not match any Indian customs station, so the ` +
        'transport mode fell back to Sea (S). If this consignment moves to an ICD it should be Land (L) — ' +
        'set it on the job.',
    });
  } else if (transportMode === 'Land' && deliveryStation) {
    flags.push({
      severity: 'info',
      path: 'transportMode',
      message:
        `Transport mode L: the bill of lading delivers to ${deliveryStation.name} (${deliveryStation.code}), ` +
        'an inland station. Confirm this is where the Bill of Entry is filed.',
    });
  }

  // The custom house is deliberately not defaulted here. Which station a
  // consignment is filed at is the customer's instruction, not a property of
  // the transport mode — the previous `awb ? 'INBOM4' : 'INNSA1'` put a code on
  // a customs declaration that nobody had chosen. applyGeneralResolution fills
  // it from the instruction mail, the importer's default, or the operator.
  if (deliveryStation) {
    flags.push({
      severity: 'info',
      path: 'customStation',
      message:
        `The bill of lading delivers to ${deliveryStation.name} (${deliveryStation.code}) — ` +
        'the likely custom house, unless the customer says otherwise.',
    });
  }

  // ---- Importer (consignee on the transport document) ----
  //
  // Just the name off the paperwork. Binding it to the organization repository
  // — the party master exported out of Logi-Sys — happens afterwards in
  // applyPartyResolution(), which needs a company and a database and so cannot
  // live in this synchronous, tenant-free merge.
  const consigneeName =
    meaningful(bl?.consigneeName) ?? meaningful(awb?.consigneeName) ?? meaningful(inv?.buyerName) ?? '';
  const importer: ChecklistDraft['importer'] = {
    name: consigneeName,
    addressLines: [],
    matchedFromMasters: false,
  };
  fieldMeta['importer.name'] = {
    confidence: 'medium',
    sources: [fileOf(docs, bl ? 'bill_of_lading' : 'air_waybill') ?? 'unknown'],
  };

  if (importer.gstin) {
    const gstinCheck = validateGstin(importer.gstin, {
      ...(importer.pan && { pan: importer.pan }),
      ...(importer.gstStateCode && { stateCode: importer.gstStateCode }),
    });
    for (const p of gstinCheck.problems) {
      flags.push({ severity: 'warning', path: 'importer.gstin', message: p });
    }
  }

  // ---- Shipment ----
  //
  // Every value here goes through `pick()`: the documents are asked in a stated
  // order, the first that has an opinion wins, and any disagreement is named on
  // the draft. The rule this enforces is that a value printed on *any* document
  // in the folder reaches the sheet — the previous `bl?.x ?? awb?.x` chains
  // stopped at two documents and dropped whatever the packing list, the
  // invoice or the certificate of origin knew.
  const blFile = fileOf(docs, 'bill_of_lading');
  const awbFile = fileOf(docs, 'air_waybill');
  const invFile = fileOf(docs, 'invoice');
  const plFile = fileOf(docs, 'packing_list');
  const cooFile = fileOf(docs, 'certificate_of_origin');
  const pickCtx = { flags, fieldMeta };
  const weightsEqual = (a: number, b: number) => nearlyEqual(a, b);
  /** A weight or a count of zero is a document that did not state one. */
  const positive = (v: number) => v > 0;
  const kg = (v: number) => `${v} kg`;

  // Weight units, before the weights themselves: a figure whose printed unit is
  // not a weight at all ("157,703.000 MTQ" is a volume) must not become a
  // gross weight, and one printed in pounds must be converted rather than
  // declared as kilograms.
  const printedGrossUnit = bl?.grossWeightUnitAsPrinted ?? awb?.grossWeightUnitAsPrinted;
  const printedNetUnit = bl?.netWeightUnitAsPrinted;
  const weightUnitCode = normalizeWeightUnit(printedGrossUnit ?? printedNetUnit) ?? 'KGS';
  if (printedGrossUnit && !normalizeWeightUnit(printedGrossUnit)) {
    flags.push({
      severity: 'warning',
      path: 'shipment.grossWeightKg',
      message:
        `The transport document states the gross weight in "${printedGrossUnit}", which is not a ` +
        'weight unit we recognise — confirm the figure is kilograms before filing.',
    });
  }

  const grossWeightKg = reconcile<number>(
    'shipment.grossWeightKg',
    'Gross weight',
    [
      { source: blFile, value: weightToKg(bl?.grossWeightKg, bl?.grossWeightUnitAsPrinted) },
      { source: awbFile, value: weightToKg(awb?.grossWeightKg, awb?.grossWeightUnitAsPrinted) },
      { source: invFile, value: inv?.grossWeightKg },
      { source: plFile, value: pl?.grossWeightKg },
      { source: cooFile, value: coo?.grossWeightKg },
    ],
    { ...pickCtx, equal: weightsEqual, format: kg, stated: positive },
  );

  // Net weight. The packing list is usually the only document that states it
  // explicitly; on a bill of lading it tends to sit in the description block as
  // free text, which is why the extraction prompt asks for the body to be read.
  //
  // Net weight cannot exceed gross: the packaging weighs something. So a
  // reading that does is only used when every reading does.
  const netWeightKg = reconcile<number>(
    'shipment.netWeightKg',
    'Net weight',
    [
      { source: blFile, value: weightToKg(bl?.netWeightKg, bl?.netWeightUnitAsPrinted) },
      { source: plFile, value: pl?.netWeightKg },
      { source: invFile, value: inv?.netWeightKg },
      { source: awbFile, value: awb?.netWeightKg },
    ],
    {
      ...pickCtx,
      equal: weightsEqual,
      format: kg,
      stated: positive,
      ...(grossWeightKg != null ? { plausible: (v: number) => v <= grossWeightKg } : {}),
    },
  );

  if (grossWeightKg != null && netWeightKg != null && netWeightKg > grossWeightKg) {
    flags.push({
      severity: 'warning',
      path: 'shipment.netWeightKg',
      message: `Net weight (${netWeightKg} kg) exceeds gross (${grossWeightKg} kg) — one of the two is misread.`,
    });
  }

  // Containers come from EVERY bill of lading in the job, not just the one that
  // drives the rest of the draft. A house B/L and its master describe the same
  // boxes, and either can be the document that actually lists them — `ex_job6`
  // prints six numbers on the face of the master while the annex carries the
  // description. Taking them from one document is how a six-container shipment
  // was filed as one, so this is a union, deduplicated on the number.
  const containers = allBls
    .map((b) => b.containers)
    .reduce<typeof allBls[number]['containers']>((acc, list) => mergeContainerLists(acc, list), []);

  // What the B/L says the total is, kept beside the list so the export can say
  // out loud when the two disagree rather than filing the shorter one quietly.
  const containerCountStated = allBls
    .map((b) => b.containerCount)
    .find((n): n is number => n != null && n > 0);

  const shipment: ChecklistDraft['shipment'] = {
    containers: containers.map((c) => ({
      number: c.number,
      ...(c.sizeType != null ? { sizeType: c.sizeType } : {}),
      ...(c.sealNo != null ? { sealNo: c.sealNo } : {}),
      ...(c.packagesStuffed != null ? { packagesStuffed: c.packagesStuffed } : {}),
      ...(c.grossWeightKg != null ? { grossWeightKg: c.grossWeightKg } : {}),
    })),
    ...(containerCountStated != null ? { containerCountStated } : {}),
  };

  if (allBls.length > 0 && containers.length === 0) {
    flags.push({
      severity: 'warning',
      path: 'shipment.containers',
      message:
        'No containers could be read off the bill of lading. The CONTAINERS sheet will be empty — ' +
        'add them on the job before filing.',
    });
  } else if (containerCountStated != null && containerCountStated !== containers.length) {
    flags.push({
      severity: 'warning',
      path: 'shipment.containers',
      message:
        `The bill of lading states ${containerCountStated} container${containerCountStated === 1 ? '' : 's'} ` +
        `and ${containers.length} could be read. The Bill of Entry would declare ${containers.length} — ` +
        'check the container list against the B/L.',
    });
  }

  // An ISO 6346 number carries its own check digit. One that fails it is a
  // misread box, and it is kept rather than dropped: removing it would shrink
  // the list again, which is the failure this whole path exists to stop.
  for (const c of containers) {
    if (!isValidContainerNumber(c.number)) {
      flags.push({
        severity: 'warning',
        path: 'shipment.containers',
        message:
          `Container number ${c.number} fails its ISO 6346 check digit — it is misread or mistyped. ` +
          'It is kept on the draft; correct it on the job before filing.',
      });
    }
  }

  // ---- The transport document ----
  //
  // MAWB_MBL_No and AWB_BL_Date must carry the MAIN CARRIER's document. A
  // freight forwarder's house B/L is not that document, and writing it there
  // declares the wrong carrier to Customs — so a house B/L goes to the house
  // columns and the master columns stay empty until the master B/L arrives.
  const mawbNo = meaningful(awb?.mawbNumber);
  const hawbNo = meaningful(awb?.hawbNumber);
  if (mawbNo) shipment.mawbNo = mawbNo;
  if (awb?.awbDate) shipment.mawbDate = awb.awbDate;
  if (hawbNo) {
    shipment.hawbNo = hawbNo;
    // The house AWB's own date when it has one; the master's is the fallback,
    // which is what both golden air jobs print.
    const hawbDate = awb?.hawbDate ?? awb?.awbDate;
    if (hawbDate) shipment.hawbDate = hawbDate;
  }
  if (bl) {
    const blDate = bl.shippedOnBoardDate ?? bl.blDate ?? bl.issueDate ?? undefined;
    const blNumber = meaningful(bl.blNumber);
    if (bl.isHouseBl) {
      if (blNumber) shipment.hblNo = blNumber;
      if (blDate) shipment.hblDate = blDate;
      // Only the master B/L may fill the master columns.
      const master = meaningful(bl.masterBlNumber);
      if (master) {
        shipment.blNo = master;
        if (bl.masterBlDate) shipment.blDate = bl.masterBlDate;
      } else {
        flags.push({
          severity: 'warning',
          path: 'shipment.blNo',
          message:
            `Only a house bill of lading (${bl.blNumber}) was supplied and it does not quote its ` +
            'master B/L. The Bill of Entry declares the main carrier’s document, so MAWB_MBL_No ' +
            'and AWB_BL_Date are being left empty — obtain the master B/L.',
        });
      }
    } else {
      if (blNumber) shipment.blNo = blNumber;
      if (blDate) shipment.blDate = blDate;
      // A separate house B/L travelling with the master fills the house columns.
      const houseNumber = meaningful(houseBl?.blNumber);
      if (houseBl && houseNumber) {
        shipment.hblNo = houseNumber;
        const hblDate = houseBl.shippedOnBoardDate ?? houseBl.blDate ?? houseBl.issueDate;
        if (hblDate) shipment.hblDate = hblDate;
      }
    }

    if (bl.shippedOnBoardDate && bl.issueDate && bl.shippedOnBoardDate !== bl.issueDate) {
      flags.push({
        severity: 'info',
        path: 'shipment.blDate',
        message:
          `Bill of lading dated ${bl.shippedOnBoardDate} (shipped on board); it was issued ` +
          `${bl.issueDate}. The BE declares the on-board date.`,
      });
    }

    // The other reference numbers the form carries. Not exported, but a
    // mis-picked B/L number is the failure that is impossible to spot on the
    // sheet and obvious next to the alternatives.
    const alternates = [
      bl.bookingNumber ? `booking ${bl.bookingNumber}` : undefined,
      bl.agencyReferenceNumber ? `agency ref ${bl.agencyReferenceNumber}` : undefined,
    ].filter(Boolean);
    if (
      alternates.length &&
      bl.agencyReferenceNumber &&
      !sameIdentifier(bl.agencyReferenceNumber, bl.blNumber)
    ) {
      flags.push({
        severity: 'info',
        path: 'shipment.blNo',
        message:
          `Filing B/L ${bl.blNumber}; the document also carries ${alternates.join(' and ')}. ` +
          'Check which number the line files under — some carriers file the agency reference.',
      });
    }

    const delivery = meaningful(bl.placeOfDelivery);
    const discharge = meaningful(bl.portOfDischarge);
    if (delivery) shipment.placeOfDelivery = delivery;
    if (discharge) shipment.portOfDischarge = discharge;
  }
  if (awb) {
    const destination = meaningful(awb.airportOfDestination);
    if (destination) shipment.airportOfDestination = destination;
  }

  // ---- Carrier, vessel and voyage ----
  //
  // Air: the airline is the MAWB's 3-digit prefix, not the name in the
  // "Issuing Carrier's Agent" box — that box holds a freight forwarder on every
  // air job in the fixtures. Sea: the carrier field first, the prominent name
  // on the form second.
  if (transportMode === 'Air') {
    // The master air waybill's first three digits name the airline. Sliced
    // rather than handed over whole: `lookupAirline` matches a prefix on a word
    // boundary, and "61854841905" has none after the 618.
    const prefix = awb?.carrierIataPrefix ?? shipment.mawbNo?.replace(/\D/g, '').slice(0, 3);
    const airline = lookupAirline(prefix);
    const stated = awb?.operatingCarrier ?? awb?.issuingCarrierOrAgent ?? undefined;
    if (airline) {
      shipment.shippingLineOrCarrier = airline.name;
      if (
        awb?.issuingCarrierOrAgent &&
        !airline.name.toUpperCase().includes(awb.issuingCarrierOrAgent.toUpperCase().slice(0, 6))
      ) {
        flags.push({
          severity: 'info',
          path: 'shipment.shippingLineOrCarrier',
          message:
            `Carrier read as ${airline.name} from air waybill prefix ` +
            `${prefix}. The form names ` +
            `"${awb.issuingCarrierOrAgent}", which is the issuing agent, not the airline.`,
        });
      }
    } else if (stated) {
      shipment.shippingLineOrCarrier = stated;
      flags.push({
        severity: 'warning',
        path: 'shipment.shippingLineOrCarrier',
        message:
          `Air waybill prefix ${prefix ?? '?'} is ` +
          `not in the airline master, so "${stated}" is being used — it may be the forwarder ` +
          'rather than the carrier. Verify before filing.',
      });
    }

    // A flight number belongs in FlightNo_VoyageNo, and no aircraft name goes
    // in VesselName. `flightAndDate` mixes the two, so it is only a fallback.
    if (awb?.flightNumber) shipment.voyageNo = awb.flightNumber;
    else if (awb?.flightAndDate) shipment.vesselOrFlight = awb.flightAndDate;
  } else {
    const seaCarrier = reconcile<string>(
      'shipment.shippingLineOrCarrier',
      'Carrier',
      [
        { source: blFile, value: bl?.carrierName },
        { source: blFile, value: bl?.shippingLine },
      ],
      { ...pickCtx, equal: sameIdentifier, warnOnConflict: false },
    );
    if (seaCarrier) shipment.shippingLineOrCarrier = seaCarrier;

    // Vessel and voyage: the B/L's own boxes when it has them, otherwise split
    // the combined string. A blank voyage column a human fills in beats a
    // vessel name silently truncated, which is why `splitVoyage` may decline.
    if (bl?.vesselName) shipment.vesselOrFlight = bl.vesselName;
    else if (bl?.vesselVoyage) shipment.vesselOrFlight = bl.vesselVoyage;
    if (bl?.voyageNo) shipment.voyageNo = bl.voyageNo;
    else if (shipment.vesselOrFlight) {
      const voyage = splitVoyage(shipment.vesselOrFlight);
      if (voyage) shipment.voyageNo = voyage;
    }
  }

  // ---- Port of loading ----
  const pol = meaningful(bl?.portOfLoading) ?? meaningful(awb?.airportOfDeparture);
  if (pol) {
    // The looser matcher: a document writes "SHANGHAI, CHINA" or "Qingdao Port",
    // not the bare name. It falls back to the exact one internally.
    const port = lookupForeignPortLoose(pol) ?? lookupForeignPort(pol);
    if (port) {
      // ICES format "Boston(USBOS)" + consignment country from the port master
      shipment.portOfLoading = formatForeignPort(port);
      shipment.consCountry = port.country;
    } else {
      shipment.portOfLoading = pol;
      const polParts = pol.split(',').map((s) => s.trim()).filter(Boolean);
      const polCountry = polParts.length > 1 ? polParts.at(-1) : undefined;
      if (polCountry && polCountry.length > 2) shipment.consCountry = polCountry;
      flags.push({
        severity: 'info',
        path: 'shipment.portOfLoading',
        message: `Port "${pol}" not in the foreign-ports master — add it to get the UN/LOCODE format and consignment country automatically.`,
      });
    }
  }
  if (coo?.issuingCountry) shipment.countryOfOrigin = coo.issuingCountry;

  // ---- Packages ----
  //
  // The container count is deliberately not a candidate. A B/L totals box
  // reading "0004 CNTR" beside cargo of "4000 BAG(S)" is the trap this guards:
  // four is a true number on the document and a false package count.
  const pkgCount = reconcile<number>(
    'shipment.packageCount',
    'Package count',
    [
      { source: blFile, value: bl?.packageCount },
      { source: awbFile, value: awb?.pieces },
      { source: plFile, value: pl?.packageCount },
      { source: cooFile, value: coo?.packageCount },
    ],
    { ...pickCtx, equal: (a, b) => a === b, format: (v) => String(v), stated: positive },
  );
  if (pkgCount != null) shipment.packageCount = pkgCount;
  if (
    pkgCount != null &&
    bl?.containerCount != null &&
    bl.containerCount > 0 &&
    pkgCount === bl.containerCount
  ) {
    flags.push({
      severity: 'warning',
      path: 'shipment.packageCount',
      message:
        `Package count (${pkgCount}) equals the container count on the bill of lading. The BE ` +
        'declares packages — bags, cartons, drums — not containers. Check the cargo description.',
    });
  }

  const pkgUnit = reconcile<string>(
    'shipment.packageUnit',
    'Package kind',
    [
      { source: blFile, value: bl?.packageUnit },
      { source: awbFile, value: awb?.packageUnit },
      { source: plFile, value: pl?.packageUnit },
      { source: cooFile, value: coo?.packageUnit },
    ],
    {
      ...pickCtx,
      // "BAGS" and "BAG(S)" are the same kind; compare after the master.
      equal: (a, b) => (normalizePackageUnit(a) ?? a) === (normalizePackageUnit(b) ?? b),
    },
  );
  if (pkgUnit) shipment.packageUnit = pkgUnit;

  if (grossWeightKg != null) shipment.grossWeightKg = grossWeightKg;
  if (netWeightKg != null) shipment.netWeightKg = netWeightKg;
  shipment.weightUnitCode = weightUnitCode;

  if (!shipment.countryOfOrigin && inv?.countryOfOrigin) shipment.countryOfOrigin = inv.countryOfOrigin;
  const originFallback = inv?.sellerCountry ?? shipment.consCountry;
  if (!shipment.countryOfOrigin && originFallback) {
    shipment.countryOfOrigin = originFallback;
    flags.push({
      severity: 'warning',
      path: 'shipment.countryOfOrigin',
      message: `Country of origin assumed from ${inv?.sellerCountry ? 'supplier country' : 'port of loading country'} (${originFallback}) — no COO/invoice declaration found, verify.`,
    });
  }
  if (!shipment.countryOfOrigin)
    flags.push({ severity: 'warning', path: 'shipment.countryOfOrigin', message: 'Country of origin not found on COO or invoice.' });

  // ---- Marks & Nos ----
  //
  // Air Bills of Entry print the master air waybill number, a dotted rule, then
  // the house number. Both golden air checklists do it identically:
  //
  //     Marks & Nos     05779606800
  //                     ................
  //                     BOS0121016
  //
  // (ex_job1; ex_job5 the same with 61854841905 / OGC2606212). `cell.text()`
  // collapses the newlines, so the exported cell reads
  // "05779606800 ................ BOS0121016". A lone MAWB when there is no
  // house waybill.
  //
  // Sea filings print "AS PER BL" by convention. That is a default, not a law:
  // a re-import or free-of-cost consignment carries a declaration instead
  // ("RE-IMPORT OF INDIAN ORIGIN GOODS & RE EXPORTED" on ex_job3, "INV NO-.../
  // REJECTED AND RETURNBLE CARGO" on ex_job4), which only a person can write.
  // So the operator's value, once set, survives a re-read of the documents.
  const documentMarks = reconcile<string>(
    'shipment.marksAndNos',
    'Marks & numbers',
    [
      { source: blFile, value: bl?.marksAndNumbers },
      { source: plFile, value: pl?.marksAndNumbers },
    ],
    { ...pickCtx, equal: sameIdentifier, warnOnConflict: false },
  );
  if (transportMode === 'Air') {
    if (shipment.mawbNo) {
      shipment.marksAndNos = shipment.hawbNo
        ? `${shipment.mawbNo}\n${AIR_MARKS_RULE}\n${shipment.hawbNo}`
        : shipment.mawbNo;
    }
  } else if (bl) {
    if (documentMarks && !sameIdentifier(documentMarks, 'AS PER BL'))
      flags.push({
        severity: 'info',
        path: 'shipment.marksAndNos',
        message: `Marks set to "AS PER BL" (BE convention); BL printed: ${documentMarks.replace(/\s+/g, ' ').slice(0, 60)}`,
      });
    shipment.marksAndNos = 'AS PER BL';
  } else if (documentMarks) {
    shipment.marksAndNos = documentMarks;
  }

  if (bl?.isDraftDocument)
    flags.push({
      severity: 'warning',
      path: 'shipment.blNo',
      message: 'The bill of lading appears to be a DRAFT — confirm the final BL number and date before filing.',
    });

  // Consignment country: where goods were consigned from (port of loading country).
  flags.push({
    severity: 'info',
    path: 'shipment.eta',
    message: 'ETA not automated yet — key it from the shipping line website / arrival notice.',
  });

  // ---- Filing status ----
  //
  // Not guessed. Advance/Prior/Normal is a function of whether an IGM has been
  // filed against this BL and whether entry inwards has been granted, and
  // neither fact is on any document the customer sends. It was previously
  // `Air ? 'Prior' : 'Normal'`, which had no relationship to the rule. It stays
  // unset until someone keys the IGM and inward dates on the job.
  flags.push({
    severity: 'warning',
    path: 'filingStatus',
    message:
      'Filing status (Advance/Prior/Normal) needs the IGM number and the entry-inwards date — ' +
      'neither is on the shipping documents. Key them on the job from ICEGATE or the shipping line.',
  });

  // ---- Invoices & valuation ----
  // Every rule below is per invoice: terms of invoice, currency, charges and
  // the insurance gap all belong to one sale, and a BE that carries twelve
  // sales carries twelve answers.
  const rates = exchangeRatesOn(today);

  // A bank's certificate stands in for the notification on a currency the
  // Ministry of Finance does not notify — ICES calls those "non-standard" and
  // makes the bank block mandatory on the row (error 155).
  const bankRateCertificates: NonNullable<
    ChecklistDraft['invoiceMeta']['bankRateCertificates']
  > = {};
  for (const cert of pickAll<BankCertificateExtract>(docs, 'bank_certificate')) {
    const currency = cert.currency?.trim().toUpperCase();
    if (!currency || cert.rate == null || !cert.bankName || !cert.certificateNo || !cert.certificateDate) {
      flags.push({
        severity: 'warning',
        path: 'invoiceMeta.bankRateCertificates',
        message:
          'A bank exchange-rate certificate was attached but does not state all of the currency, ' +
          'rate, bank name, certificate number and date. ICES needs every one of them on the ' +
          'EXCHANGE_RATE row, so it was not used.',
      });
      continue;
    }
    // Some certificates quote per 100 units. The BE converts per unit, and
    // dividing silently is how a rate ends up two orders of magnitude out.
    const perUnits = cert.ratePerUnits ?? 1;
    bankRateCertificates[currency] = {
      rate: cert.rate / perUnits,
      bankName: cert.bankName,
      certificateNo: cert.certificateNo,
      certificateDate: cert.certificateDate,
    };
  }

  // The high-seas chain, off the agreement. Its *seller* is preceding level 0 —
  // ICES counts backwards from the importer filing the BE, who is on GENERAL
  // and never on the HSS sheet. One agreement is one link; a chain of two sales
  // arrives as two agreements, and the operator orders them.
  const hssAgreements = pickAll<HighSeasAgreementExtract>(docs, 'high_seas_agreement');
  const hssChain: HssParty[] = [];
  for (const [i, agreement] of hssAgreements.entries()) {
    const seller = agreement.seller;
    if (!seller?.iec) {
      if (seller) {
        flags.push({
          severity: 'warning',
          path: 'hssChain',
          message:
            `The high-seas-sale agreement names ${seller.name} as seller but prints no IE Code. ` +
            'ICES looks the party up by it (error 161), so the chain cannot be declared until ' +
            'somebody supplies one.',
        });
      }
      continue;
    }
    hssChain.push({
      level: i,
      iec: seller.iec.trim().toUpperCase(),
      name: seller.name,
      ...(seller.address && { address: seller.address }),
      ...(seller.city && { city: seller.city }),
      ...(seller.country && { country: seller.country }),
      ...(seller.postalCode && { postalCode: seller.postalCode }),
    });
  }
  if (hssChain.length) {
    flags.push({
      severity: 'warning',
      path: 'hssChain',
      message:
        `A high-seas-sale agreement is on this job, naming ${hssChain.length} seller` +
        `${hssChain.length === 1 ? '' : 's'}. Tick the high-seas-sale box and confirm each ` +
        'party\u2019s branch serial — ICES rejects an unregistered branch (error 163) and there is ' +
        'no safe default.',
    });
  }
  // The documents the charge block is read off. Each is matched to its invoice
  // by the number it quotes, and falls back to the only one on the job when it
  // quotes none — which is how most of them arrive.
  const freightCerts = pickAll<FreightCertificateExtract>(docs, 'freight_certificate');
  const insuranceCerts = pickAll<InsuranceCertificateExtract>(docs, 'insurance_certificate');
  const purchaseOrders = pickAll<PurchaseOrderExtract>(docs, 'purchase_order');
  const contracts = pickAll<ContractExtract>(docs, 'contract');
  const forInvoice = <T extends { invoiceNumberRef?: string | null }>(
    list: T[],
    invoiceNumber: string,
  ): T | undefined =>
    list.find((c) => sameRef(c.invoiceNumberRef, invoiceNumber)) ??
    (list.length === 1 && invoiceDocs.length === 1 ? list[0] : undefined);

  const invoices: DraftInvoice[] = invoiceDocs.map((doc, di) => {
    const srNo = di + 1;
    const path = `invoices.${di}`;
    const chargeItems = doc.items.filter((i) => i.isCharge);
    const goodsValue = doc.items.filter((i) => !i.isCharge).reduce((a, i) => a + (i.amount ?? 0), 0);
    const toi = normalizeToi(doc.termsOfInvoice);
    if (doc.termsOfInvoice === 'UNKNOWN')
      flags.push({ severity: 'warning', path: `${path}.termsOfInvoice`, message: `Invoice ${doc.invoiceNumber}: terms of invoice unclear on documents — defaulted to C&F.` });

    // Charge lines billed on the invoice ride as dutiable misc charges — a
    // FREIGHT-CHARGE line on `ex_job1`'s invoice is filed as Misc. Charges
    // 590.75 USD, out of the invoice value. The extractor may surface them as
    // line items OR as freightCharge; line items win, to avoid double counting.
    const currency = doc.currency || 'USD';
    let chargesTotal = chargeItems.reduce((a, i) => a + (i.amount ?? 0), 0);
    let chargesCurrency = currency;
    if (chargesTotal === 0 && doc.freightCharge && doc.freightCharge.amount > 0) {
      chargesTotal = doc.freightCharge.amount;
      chargesCurrency = doc.freightCharge.currency;
    }

    // Ex-Works/FOB invoice that itself bills freight is effectively C&F on the
    // BE (`ex_job1`: EXW invoice + freight line -> TOI C&F, freight as misc).
    let effectiveToi = toi;
    if ((toi === 'EXW' || toi === 'FOB') && chargesTotal > 0) {
      effectiveToi = 'C&F';
      flags.push({
        severity: 'info',
        path: `${path}.termsOfInvoice`,
        message: `Invoice ${doc.invoiceNumber} is ${toi} but bills freight/charges (${chargesTotal} ${currency}) — TOI set to C&F with charges as misc.`,
      });
    }
    if (effectiveToi === 'EXW')
      flags.push({
        severity: 'warning',
        path: `${path}.termsOfInvoice`,
        message: `Invoice ${doc.invoiceNumber} is Ex-Works — actual freight to port of loading must be added manually.`,
      });
    if (!rates[currency] && currency !== 'INR')
      flags.push({ severity: 'error', path: 'invoiceMeta.exchangeRates', message: `No customs exchange rate seeded for ${currency}.` });

    // Freight, off the certificate. Either an amount or a rate, never both —
    // the two are the same claim and Logi-Sys takes one column or the other.
    const freightCert = forInvoice(freightCerts, doc.invoiceNumber);
    const freight =
      freightCert?.freightAmount && freightCert.freightAmount.amount > 0
        ? freightCert.freightAmount
        : undefined;

    // The ex-works leg and any other charge the certificate bills separately
    // are miscellaneous, not freight. Converted into the invoice currency
    // before they are added, because ICES takes that column in it.
    for (const extra of [freightCert?.exWorksAmount, freightCert?.otherChargesAmount]) {
      if (!extra || extra.amount <= 0) continue;
      const converted = convertTo(extra, currency, rates);
      if (converted == null) {
        flags.push({
          severity: 'warning',
          path: `${path}.miscCharges`,
          message:
            `The freight certificate bills ${extra.amount} ${extra.currency} apart from the freight, ` +
            `and there is no customs rate to convert it into ${currency}. Add it to the miscellaneous ` +
            'charges by hand.',
        });
        continue;
      }
      chargesTotal += converted;
      chargesCurrency = currency;
    }

    // Insurance: the premium off the certificate, else a premium billed on the
    // invoice itself. The sum insured on the certificate is what the goods are
    // covered for and is never the figure declared.
    const insuranceCert = forInvoice(insuranceCerts, doc.invoiceNumber);
    const premium =
      insuranceCert?.premiumAmount && insuranceCert.premiumAmount.amount > 0
        ? insuranceCert.premiumAmount
        : doc.insuranceCharge && doc.insuranceCharge.amount > 0
          ? doc.insuranceCharge
          : undefined;
    const insurance = premium
      ? ({ kind: 'amount', value: premium } as const)
      : insuranceCert?.premiumRatePercent
        ? ({ kind: 'percent', percent: insuranceCert.premiumRatePercent } as const)
        : undefined;

    // "If given" — the invoice quotes them more often than a separate document
    // arrives, so the document wins only where there is one.
    const po = purchaseOrders.find((o) => sameRef(o.orderNumber, doc.purchaseOrderNumber)) ??
      (purchaseOrders.length === 1 && invoiceDocs.length === 1 ? purchaseOrders[0] : undefined);
    const contract = contracts.find((c) => sameRef(c.contractNumber, doc.contractNumber)) ??
      (contracts.length === 1 && invoiceDocs.length === 1 ? contracts[0] : undefined);
    const purchaseOrderNumber = doc.purchaseOrderNumber ?? po?.orderNumber ?? undefined;
    const purchaseOrderDate = statedDate(doc.purchaseOrderDate) ?? statedDate(po?.orderDate);
    const contractNumber = doc.contractNumber ?? contract?.contractNumber ?? undefined;
    const contractDate = statedDate(doc.contractDate) ?? statedDate(contract?.contractDate);
    const lcDate = statedDate(doc.lcDate);
    if ((effectiveToi === 'FOB' || effectiveToi === 'C&F') && !insurance) {
      // The importer's marine open policy is not known here — it hangs off the
      // organization repository row, which is only bound after this merge — so
      // applyPartyResolution() fills it in and clears this warning if it can.
      flags.push({
        severity: 'warning',
        path: `${path}.insurance`,
        message: `Invoice ${doc.invoiceNumber}: TOI is ${toi} — add actual insurance (or set the importer's marine open-policy rate on the organization).`,
      });
    }

    const termsPlace = termsPlaceOf(doc);
    return {
      srNo,
      invoiceNumber: doc.invoiceNumber,
      invoiceDate: statedDate(doc.invoiceDate) ?? '',
      termsOfInvoice: effectiveToi === 'EXW' ? 'FOB' : effectiveToi,
      currency,
      invoiceValue: goodsValue,
      ...(termsPlace && { termsPlace }),
      ...(chargesTotal > 0 && { miscCharges: { amount: chargesTotal, currency: chargesCurrency } }),
      ...(freight && { freight }),
      ...(insurance && { insurance }),
      ...(doc.paymentTerms && { termsOfPayment: doc.paymentTerms }),
      ...(purchaseOrderNumber && { purchaseOrderNumber }),
      ...(purchaseOrderDate && { purchaseOrderDate }),
      ...(contractNumber && { contractNumber }),
      ...(contractDate && { contractDate }),
      ...(doc.lcNumber && { lcNumber: doc.lcNumber }),
      ...(lcDate && { lcDate }),
      paymentMethod: 'Transaction',
      natureOfTransaction: natureOfTransactionFor(doc),
      relatedParty: false,
    };
  });
  if (!invoices.length)
    flags.push({
      severity: 'error',
      path: 'invoices',
      message: 'No commercial invoice was read on this job — the Bill of Entry has nothing to declare.',
    });

  // ---- Items (description+HSN from invoice; rates from masters) ----
  //
  // What the documents say about each line is read here. What the duty masters
  // say — AIDC and SWS serials, the preferential claim, trade remedies, tariff
  // values — depends on the final CTH and is settled by resolveItems() at the
  // end of the merge and again after enrichment. See items-resolve.ts and
  // docs/boe-mapping/06-items.md.
  const cooDocs = pickAll<CooExtract>(docs, 'certificate_of_origin');

  // Every goods line on the job, in invoice order, each remembering which
  // invoice billed it. `slNo` restarts per invoice — ICES field 8 is the item
  // serial *within* the invoice — while `idx` stays BE-wide, so flag paths and
  // the packing/unit passes below still address one flat list.
  const goodsLines = invoiceDocs.flatMap((doc, di) =>
    doc.items
      .filter((i) => !i.isCharge)
      .map((gi, k) => ({ gi, doc, invoiceSrNo: di + 1, slNo: k + 1 })),
  );
  const goodsItems = goodsLines.map((l) => l.gi);

  const items: DraftItem[] = goodsLines.map(({ gi, doc, invoiceSrNo, slNo }, idx) => {
    // A valid HS/RITC candidate has at least 6 digits (part numbers and noise don't).
    const hsCandidates = [
      gi.hsCode,
      doc.items.find((x) => x.hsCode)?.hsCode,
      coo?.hsCode,
      bl?.hsCode,
      awb?.hsCode,
    ]
      .map((c) => (c ?? '').replace(/\D/g, ''))
      .filter((c) => c.length >= 6);
    const hs = hsCandidates[0] ?? '';
    let ritcSource: 'document' | 'master' | 'default' = hs ? 'document' : 'default';
    let tariff = hs.length >= 8 ? lookupTariff(hs.slice(0, 8)) : undefined;
    let ritc = hs.slice(0, 8);
    // How a partial code failed to resolve, kept so the flag below can say
    // which problem this line has rather than one message for all of them.
    let prefix: ReturnType<typeof resolveTariffPrefix> | undefined;
    if (!tariff && hs.length >= 4 && hs.length < 8) {
      prefix = resolveTariffPrefix(hs);
      if (prefix.reason === 'unique' && prefix.row) {
        tariff = prefix.row;
        ritc = prefix.row.cth;
        flags.push({
          severity: 'warning',
          path: `items.${idx}.ritc`,
          message: `RITC ${tariff.cth} completed from ${hs.length}-digit HS ${hs} on the shipping docs — verify the full CTH.`,
        });
      } else if (prefix.reason === 'all-agree') {
        // Every child of the heading carries the same duty, so the money is
        // not in doubt even though the code is. Taking the rates and leaving
        // the RITC to a human is the honest split: a Bill of Entry declares a
        // code, and picking one of six arbitrarily would be inventing it.
        const [first] = prefix.candidates;
        tariff = first;
        flags.push({
          severity: 'warning',
          path: `items.${idx}.ritc`,
          message:
            `HS ${hs} covers ${prefix.candidates.length} tariff items, all at BCD ${first!.bcdRate}% ` +
            `and IGST ${first!.igstRate}% — duty is safe but the RITC must be chosen: ` +
            `${prefix.candidates.slice(0, 6).map((c) => c.cth).join(', ')}` +
            `${prefix.candidates.length > 6 ? ', …' : ''}`,
        });
      }
    }
    // job memory: this importer has imported this product before
    if (!tariff && importer.name) {
      const memory = recallProductMemory(importer.name, gi.description);
      if (memory) {
        ritc = memory.ritc;
        ritcSource = 'master';
        tariff = lookupTariff(memory.ritc);
        flags.push({
          severity: 'info',
          path: `items.${idx}.ritc`,
          message: `RITC ${memory.ritc} recalled from job memory (learned from ${memory.learnedFrom}) for "${gi.description.slice(0, 40)}…" — verify.`,
        });
      }
    }
    // The tariff master has a row per CTH the CHA has filed before. For
    // everything else the two standing CBIC notifications still answer half
    // the question: 9/2025-IT(R) gives the IGST rate outright, and
    // 45/2025-Customs offers the BCD concessions the goods might qualify for.
    const igst = igstRateForCth(ritc);
    // "II114" — the schedule and serial the Bill of Entry files beside the
    // notification number. The tariff master carries neither, but a serial
    // only belongs to its own notification: a master row filed under some
    // other one keeps its number bare.
    const igstSerial =
      igst && !igst.residual && (!tariff || tariff.igstNotification === igst.notification)
        ? `${igst.entry.schedule}${igst.entry.serial}`
        : undefined;
    // Compensation cess. Every Bill of Entry declares 1/2017 and a serial,
    // whether or not the goods bear a cess: goods no serial names are covered
    // by S.No. 56 at nil, and that pair is what the column asks for. This used
    // to come from the tariff master, which knows three CTHs, so the two
    // columns were blank on every other line.
    const cess = compCessForCth(ritc);
    // Blank when two serials contest the CTH — cigarettes and motor vehicles
    // are split by description at the same code, and picking the first is a
    // rate we cannot evidence. The error flag below sends it to the reviewer,
    // and enrichDraftFromNotifications settles it when a model is available.
    const cessSerial =
      cess &&
      !cess.alternatives.length &&
      (!tariff || tariff.compCessNotification === cess.notification)
        ? cess.entry.serial
        : undefined;
    const igstNotn = tariff?.igstNotification ?? igst?.notification;
    const cessNotn = tariff?.compCessNotification ?? cess?.notification;
    const serials =
      igstSerial || cessSerial
        ? { ...(igstSerial && { igst: igstSerial }), ...(cessSerial && { compCess: cessSerial }) }
        : undefined;
    // Where the tariff master and 9/2025-IT(R) disagree.
    //
    // This cannot be a bare `igst.rate !== tariff.igstRate` any more. The
    // master now carries the printed tariff, whose IGST column is written
    // against the goods, while igstRateForCth matches on code alone — so for
    // heading 0203 the lookup returns the 5% entry whose description reads "all
    // goods, other than fresh or chilled", and fresh pork legitimately differs
    // from it. Compared naively that is 3,106 disagreements, nearly all false,
    // on produce and meat lines that appear in real jobs every week.
    //
    // tariffDissent has already separated the three populations at load time:
    // entries the description decides, the 125 rows where the book says nil
    // because the IGST *exemption* notification exempts them and we do not
    // parse it, and the ~87 where both sources name a rate and differ. Only the
    // last is a conflict, and only it is worth a person's attention.
    const dissent = tariffDissent(ritc);
    if (tariff && dissent.length) {
      const [d] = dissent;
      flags.push({
        severity: 'error',
        path: `items.${idx}.igstRate`,
        message:
          `IGST conflict for CTH ${ritc}: notification ${d!.notification} S.No. ${d!.serial} says ` +
          `${d!.cbic}%, the ${tariffEdition()} printed tariff says ${d!.book}% (p.${d!.page}). ` +
          `The notification is being used because it is the primary source, but these are mostly ` +
          `demerit goods where the 40% slab is the question — confirm which is in force on the ` +
          `date of filing before this line goes out.`,
      });
    }
    // A named cess serial is a candidate, never a conclusion: nineteen
    // notifications amend 1/2017 and none of them is folded into the master.
    // The residual S.No. 56 says nothing, because it is the common case, it is
    // nil, and no amendment can reach it.
    if (cess && !cess.residual) {
      const alternatives = cess.alternatives
        .map((e) => `S.No. ${e.serial} says ${e.rateText}`)
        .join(', ');
      flags.push({
        severity: cess.rate == null || cess.alternatives.length ? 'error' : 'warning',
        path: `items.${idx}.compCessRate`,
        message:
          `Compensation cess: notification ${cess.notification} S.No. ${cess.entry.serial} ` +
          `covers CTH ${ritc} at "${cess.rateText}" ("${cess.entry.description.slice(0, 60)}")` +
          (alternatives ? ` — ${alternatives} for the same CTH; the goods description decides.` : '.') +
          (cess.rate == null
            ? ' The rate is specific or compound, which the duty calculator cannot apply — enter the cess by hand.'
            : '') +
          (cess.entry.brandSensitive
            ? ' The entry turns on whether the goods bear a brand name.'
            : '') +
          ` ${cess.unappliedAmendments.length} amending notifications are not folded into this master — read them before filing.`,
      });
    }
    if (tariff && cess && !cess.residual && cess.rate != null && cess.rate !== tariff.compCessRate) {
      flags.push({
        severity: 'warning',
        path: `items.${idx}.compCessRate`,
        message:
          `Tariff master says compensation cess ${tariff.compCessRate}% for CTH ${ritc}, ` +
          `notification ${cess.notification} S.No. ${cess.entry.serial} says ${cess.rateText}. ` +
          'The master is being used — correct it if the notification is right.',
      });
    }
    // Why this line has no tariff row is now three different problems, and
    // they want three different fixes. One undifferentiated error was right
    // while the master held three CTHs and every line missed it; against the
    // full First Schedule a miss is unusual and says something specific.
    //
    // It also has to be distinguishable downstream: enrichDraftFromLibrary and
    // the classification proposer find their work by matching an error flag on
    // this path, and only the first case below is theirs to answer.
    if (!tariff) {
      const goods = gi.description.slice(0, 60);
      if (!hs) {
        flags.push({
          severity: 'error',
          path: `items.${idx}.ritc`,
          message: `No HS code on the invoice, COO, B/L or AWB for "${goods}" — the CTH has to be classified before this line can be filed.`,
        });
      } else if (prefix?.reason === 'ambiguous') {
        flags.push({
          severity: 'error',
          path: `items.${idx}.ritc`,
          message:
            `HS ${hs} covers ${prefix.candidates.length} tariff items with different duty — ` +
            `the goods description has to settle which: ` +
            `${prefix.candidates.slice(0, 6).map((c) => `${c.cth} (BCD ${c.bcdRate}%)`).join(', ')}` +
            `${prefix.candidates.length > 6 ? ', …' : ''}`,
        });
      } else {
        // The code is not a tariff item at all. Against a three-row master that
        // meant nothing; against the whole First Schedule it usually means the
        // supplier printed a foreign code — a US HTS 10-digit, an EU TARIC.
        const heading = resolveTariffPrefix(hs.slice(0, 6));
        flags.push({
          severity: 'error',
          path: `items.${idx}.ritc`,
          message:
            `CTH ${hs} is not a tariff item in the ${tariffEdition()} First Schedule for "${goods}" — ` +
            (heading.candidates.length
              ? `heading ${hs.slice(0, 6)} has ${heading.candidates.length} sub-items; the supplier's code may be a foreign tariff.`
              : 'the code may be a foreign tariff or mistyped.'),
        });
      }
    }

    // DGFT policy. Nothing in the pipeline knew this before the tariff book:
    // a restricted code needs an import authorisation in hand before the Bill
    // of Entry is filed, and finding that out at the counter is a demurrage
    // bill. Stated only where the book actually reads a policy for the line.
    if (tariff?.impPolicy && tariff.impPolicy !== 'Free') {
      flags.push({
        severity: 'error',
        path: `items.${idx}.ritc`,
        message:
          `DGFT import policy for CTH ${ritc} is ${tariff.impPolicy} — ` +
          `an authorisation or licence is needed before filing. ` +
          `(${tariffEdition()} tariff, p.${tariff.provenance?.page ?? '?'})`,
      });
    }

    // Re-imports are not decided here.
    //
    // Goods that left India and are coming back usually pay no duty, under an
    // exemption that turns on *how* they left — which only the shipping bill
    // says. That used to be a blocking error on every line whose description
    // read as a return, because with the full tariff behind it the line comes
    // out at the statutory rate (sesame at 30% on ex_job3, a tenfold jump)
    // with nothing to say the duty is almost certainly not payable.
    //
    // `attachReImport` now reads the bill, fills the RE-IMPORT block and
    // proposes the notification entries, and keeps the blocker for the case it
    // was really for: a line that reads as a return with no bill on the job.
    // See src/re-import.ts and docs/boe-mapping/09-re-import.md.

    // Other customs notifications the printed tariff cites for this line.
    //
    // The masters parse three notifications — the IGST rate schedule, the
    // jumbo BCD exemption and the compensation cess — and nothing else, while
    // the tariff's REMARKS column cites 90 CBIC notifications between its
    // lines: electronics exemptions (25/2005), project imports, SEZ and EOU
    // concessions. A concession the masters do not know is not a concession
    // the goods cannot have; it is one nobody will think to check. So each one
    // the book reprints is named with the Volume II pages it is on.
    //
    // Info, not warning: a citation in REMARKS is as often the notification
    // that *withdrew* a concession ("Omitted by Ntfn 45/2025") as one that
    // grants it, and the flag cannot tell which. It says where to read.
    if (tariff?.notificationRefs?.length) {
      const parsed = new Set([
        bcdExemptionNotification(),
        compCessNotification(),
        IGST_RATE_NOTIFICATION,
        '011/2018', // SWS: already read off the SWS column itself
      ]);
      const unread = tariff.notificationRefs
        .filter((r) => r.authority !== 'DGFT' && !parsed.has(r.notification))
        .map((r) => ({ ref: r, section: tariffBookNotification(r.notification) }))
        .filter((x) => x.section?.startPage);
      if (unread.length) {
        flags.push({
          severity: 'info',
          path: `items.${idx}.bcdRate`,
          message:
            `The ${tariffEdition()} printed tariff cites ${unread.length === 1 ? 'a notification' : 'notifications'} ` +
            `for CTH ${ritc} that the duty masters do not parse: ` +
            unread
              .map(
                ({ ref, section }) =>
                  `${ref.notification}${ref.serial ? ` S.No. ${ref.serial}` : ''} ` +
                  `"${(section!.title || '').slice(0, 60)}" (Vol II p.${section!.startPage}` +
                  `${section!.endPage && section!.endPage !== section!.startPage ? `-${section!.endPage}` : ''})`,
              )
              .join('; ') +
            ` — check whether it grants or withdraws a concession on these goods.`,
        });
      }
    }
    if (!tariff && igst) {
      const cited = `notification ${igst.notification} Schedule ${igst.entry.schedule} S.No. ${igst.entry.serial} (p.${igst.entry.page})`;
      if (igst.residual) {
        // 9/2025 sets rates; goods that are nil-rated are exempted by the
        // companion IGST exemption notification, which is not in the masters.
        // So a residual answer is a prompt to check, not a conclusion.
        flags.push({
          severity: 'warning',
          path: `items.${idx}.igstRate`,
          message: `IGST ${igst.rate}% assumed for CTH ${ritc} from the residual entry of ${cited} — no schedule entry names this CTH. Check the goods are not exempt.`,
        });
      } else {
        flags.push({
          severity: igst.alternatives.length ? 'warning' : 'info',
          path: `items.${idx}.igstRate`,
          message:
            `IGST ${igst.rate}% for CTH ${ritc} from ${cited}: "${igst.entry.description.slice(0, 80)}"` +
            (igst.alternatives.length
              ? ` — ${igst.alternatives.map((a) => `S.No. ${a.serial} says ${a.rate}%`).join(', ')} for the same CTH; the goods description decides.`
              : '.'),
        });
      }
    }
    // A concession sits ON TOP of the tariff rate, so knowing the tariff rate
    // tells you nothing about whether one applies. This deliberately runs for
    // every item, including those the tariff master knows: it used to live
    // inside the `!tariff` branch above, which was harmless only while that
    // master held three rows. With the full First Schedule in it, that branch
    // stops firing and every exemption would go unnoticed.
    // A concession that has lapsed is not a candidate. The date that decides
    // it is the filing date, not today — and it is only right because the
    // amendments that move these provisos have been applied: 02/2026 alone
    // pushed 93 of them from March 2026 to March 2028.
    const covering = bcdExemptionMatches(ritc);
    const lapsed = covering.filter((e) => !isInForce(e, today));
    const exemptions = covering.filter((e) => isInForce(e, today)).slice(0, 3);
    if (lapsed.length) {
      flags.push({
        severity: 'info',
        path: `items.${idx}.bcdRate`,
        message:
          `Notification ${bcdExemptionNotification()} ` +
          lapsed.map((e) => `Table ${e.table} S.No. ${e.serial}`).join(', ') +
          ` covers CTH ${ritc} but lapsed on ${lapsed.map((e) => e.validUntil).join(', ')} — not available for a ${today} filing.`,
      });
    }
    if (exemptions.length) {
      flags.push({
        severity: 'info',
        path: `items.${idx}.bcdRate`,
        message:
          `Notification ${bcdExemptionNotification()} may cut BCD on CTH ${ritc}: ` +
          exemptions
            .map(
              (e) =>
                `Table ${e.table} S.No. ${e.serial} ${e.bcdRateText}` +
                (e.condition ? ` (condition ${e.condition})` : '') +
                (e.staleBy?.length ? ` [amended by ${e.staleBy.join(', ')}, not applied]` : '') +
                ` "${e.description.slice(0, 50)}"`,
            )
            .join('; ') +
          ' — each applies only if the goods match the description and meet the condition.',
      });
    }
    // The certificate of origin that lists this line, if one does.
    const lineCoo = cooDocs.find(
      (c) =>
        c.items.some((l) => {
          const a = (l.hsCode ?? '').replace(/\D/g, '').slice(0, 6);
          return a.length === 6 && a === ritc.slice(0, 6);
        }) || (cooDocs.length === 1 && c.items.length <= 1),
    );
    const producer = lineCoo?.producerName?.trim();
    const manufacturer: { manufacturerName?: string; manufacturerAddress?: string } = producer
      ? { manufacturerName: producer, ...(lineCoo?.producerAddress && { manufacturerAddress: lineCoo.producerAddress }) }
      : doc.manufacturerName?.trim()
        ? {
            manufacturerName: doc.manufacturerName.trim(),
            ...(doc.manufacturerAddressLines.length && { manufacturerAddress: doc.manufacturerAddressLines.join(', ') }),
          }
        : doc.sellerName
          ? { manufacturerName: doc.sellerName, manufacturerAddress: doc.sellerAddressLines.join(', ') }
          : {};
    // Every product row on the certificate of analysis that belongs to this
    // line, not just the first: one line routinely covers several lots, and
    // SW_PRODUCTION wants a row per lot (13-sw-production.md).
    const matchesLine = (p: { batchNo: string | null; productCode: string | null; description: string }) =>
      (gi.batchNo && p.batchNo === gi.batchNo) ||
      gi.description.toUpperCase().includes((p.productCode ?? p.description).toUpperCase()) ||
      p.description.toUpperCase().includes(gi.description.slice(0, 25).toUpperCase());
    const coaProducts = coa?.products.filter(matchesLine) ?? [];
    const coaProduct = coaProducts[0];
    const batchNo = gi.batchNo ?? coaProduct?.batchNo ?? undefined;
    const mfg = gi.manufactureDate ?? coaProduct?.manufactureDate ?? undefined;
    const exp = gi.expiryDate ?? coaProduct?.expiryDate ?? undefined;
    // The invoice line's own batch takes the line quantity; a certificate that
    // breaks the line into lots states each lot's own, which we do not have —
    // so extra lots carry their dates and no quantity rather than the line's.
    const batches: DraftBatch[] =
      coaProducts.length > 1
        ? coaProducts.map((pr) => ({
            ...(pr.batchNo && { batchNo: pr.batchNo }),
            ...(pr.manufactureDate && { manufactureDate: pr.manufactureDate }),
            ...(pr.expiryDate && { expiryDate: pr.expiryDate }),
            // No quantity: the line quantity belongs to the line, and splitting
            // it evenly across lots would be inventing a figure.
          }))
        : batchNo ?? mfg ?? exp
          ? [
              {
                ...(batchNo && { batchNo }),
                ...(mfg && { manufactureDate: mfg }),
                ...(exp && { expiryDate: exp }),
                ...(gi.quantity != null && { quantity: gi.quantity }),
              },
            ]
          : [];

    return {
      slNo,
      invoiceSrNo,
      description: gi.description,
      ritc,
      quantity: gi.quantity ?? 1,
      unit: normalizeUqc(gi.unit ?? 'NOS').uqc,
      unitPrice: gi.unitPrice ?? gi.amount,
      amount: gi.amount,
      bcdRate: tariff?.bcdRate ?? 0,
      swsRate: 10,
      // CBIC first where the two genuinely conflict (the flag above says so);
      // otherwise the master, which carries the printed tariff's own reading.
      igstRate: (dissent.length ? igst?.rate : undefined) ?? tariff?.igstRate ?? igst?.rate ?? 0,
      // Both notification numbers go on every line. The lookups always answer
      // for a usable CTH — 9/2025 through its residual Schedule II entry,
      // 1/2017 through S.No. 56 — so a blank here only ever meant we had not
      // asked. The tariff master still wins where it has a row, because it
      // records what this CHA actually filed.
      ...(igstNotn && { igstNotification: igstNotn }),
      ...(cessNotn && { compCessNotification: cessNotn }),
      ...(tariff && { aidcNotification: tariff.aidcNotification }),
      ...(serials && { notificationSerials: serials }),
      aidcRate: tariff?.aidcRate ?? 0,
      // A cess the calculator cannot express stays at zero rather than being
      // flattened to a wrong percentage; the error flag above says so, and it
      // is entered by hand. Same for a contested serial — two entries at the
      // same code with different rates is not a rate.
      compCessRate:
        tariff?.compCessRate ??
        (cess && !cess.residual && !cess.alternatives.length ? cess.rate ?? 0 : 0),
      // Origin: the certificate covering the line, then the invoice line, the
      // invoice, and the transport document (06-items.md §11).
      ...((lineCoo?.originCountry ?? gi.countryOfOrigin ?? doc.countryOfOrigin ?? shipment.countryOfOrigin) && {
        originCountry: (lineCoo?.originCountry ?? gi.countryOfOrigin ?? doc.countryOfOrigin ?? shipment.countryOfOrigin)!,
      }),
      // Manufacturer: the certificate's producer, then a manufacturer the
      // invoice names, then the seller — which the resolver warns about.
      ...manufacturer,
      // No constant: the mail, the product master or the importer's default
      // decides, in resolveItems(); a blank here is a question for the operator.
      endUseCode: '',
      // Seeded from the invoice description (the customer's "same as column E"),
      // refined by enrichDraftDescriptions(), and replaced by the product master.
      generalDescription: tradeDescription(gi.description),
      // "As per invoice or ask operator" / "as per invoice else NA".
      brand: gi.brand?.trim() || 'UNBRANDED',
      model: gi.model?.trim() || 'NA',
      ...((gi.noCommercialValue || doc.natureOfTransaction === 'FREE_OF_COST') && { foc: true }),
      sources: {
        ritc: ritcSource,
        brand: gi.brand?.trim() ? 'document' : 'default',
        generalDescription: 'document',
        originCountry: lineCoo?.originCountry || gi.countryOfOrigin || doc.countryOfOrigin ? 'document' : 'default',
        manufacturer: manufacturer.manufacturerName && manufacturer.manufacturerName !== doc.sellerName ? 'document' : 'default',
      },
      ...(batches.length && { batches }),
    };
  });

  // Unit normalisation to ICES UQCs, with MT -> KGS quantity conversion
  for (const [idx, gi] of goodsItems.entries()) {
    const item = items[idx]!;
    const rawUnit = (gi.unit ?? 'NOS').toUpperCase();
    // metric tons in any spelling: MT, MTS, M TONS, M.TON, TONNE... (but not MTR/metre)
    const compact = rawUnit.replace(/[^A-Z]/g, '');
    const isMetricTons =
      compact === 'MT' || compact === 'MTS' || compact.startsWith('MTON') || compact.startsWith('TON');
    if (isMetricTons) {
      item.quantity = (gi.quantity ?? 0) * 1000;
      item.unitPrice = (gi.unitPrice ?? 0) / 1000;
      item.unit = 'KGS';
      for (const b of item.batches ?? []) {
        if (b.quantity != null) b.quantity = item.quantity;
      }
      flags.push({
        severity: 'info',
        path: `items.${idx}.quantity`,
        message: 'Quantity converted MT → KGS for the BE.',
      });
    } else if (normalizeUqc(rawUnit).changed) {
      flags.push({
        severity: 'info',
        path: `items.${idx}.unit`,
        message: `Unit "${rawUnit}" normalised to UQC ${item.unit} (ICES accepts standard unit codes only).`,
      });
    }
  }

  // A line's three numbers have to multiply out, and the unit price is the one
  // that gives.
  //
  // Quantity and extended amount are both printed in full and are read off the
  // page twice over — the packing list states the quantity, the invoice total
  // states the sum of the amounts. The unit price is small print on a per-unit
  // basis the document rarely names, and it is what comes back wrong: 219.64 a
  // hundredweight against an amount of 42,698 for 19,440 kg (`ex_job20`), 185
  // against 14,800 for 17,600 kg (`ex_job21`). The exporter refuses such a line
  // outright, so those jobs could not be filed at all.
  //
  // Logi-Sys settles it the same way: its own export of `ex_job21` carries
  // `Unit_Price 0.840909` — 14,800 ÷ 17,600 to six places — not the figure on
  // the invoice. So the price is derived and the disagreement is named, rather
  // than the line being declared with numbers that do not multiply out.
  for (const [idx, item] of items.entries()) {
    if (!(item.quantity > 0) || !(item.amount > 0)) continue;
    const computed = item.quantity * item.unitPrice;
    if (Math.abs(computed - item.amount) <= 0.005 * item.amount) continue;
    const derived = item.amount / item.quantity;
    flags.push({
      severity: 'warning',
      path: `items.${idx}.unitPrice`,
      message:
        `Unit price ${item.unitPrice} does not reconcile: ${item.quantity} ${item.unit} × ` +
        `${item.unitPrice} is ${computed.toFixed(2)}, and the line is ${item.amount}. ` +
        `Filing ${derived.toFixed(6)} — the amount and the quantity are each printed in full and ` +
        'agree with the invoice total, the per-unit price is what was misread. Check the invoice.',
    });
    item.unitPrice = derived;
  }

  // Re-import: the shipping bill each returning line went out under, and the
  // notification entries it could be claiming. Runs before Single Window so a
  // re-imported line is already marked when the rest of the draft is built.
  const shippingBills = pickAll<ShippingBillExtract>(docs, 'shipping_bill');
  const reImport = attachReImport(items, shippingBills, exportInvoiceDocs, {
    ...(shipment.beFilingDate ? { beFilingDate: shipment.beFilingDate } : {}),
  });
  flags.push(...reImport.flags);

  // Single Window: shelf life + the per-line declarations of
  // docs/boe-mapping/11-sw-addl-info.md. Every family there is per-line and
  // triggered by the line's own CTH; nothing on that sheet is per-job.
  const singleWindowInfo: ChecklistDraft['singleWindowInfo'] = [];
  for (const item of items) {
    const sw = singleWindowRowsForItem(item, today);
    singleWindowInfo.push(...sw.rows);
    flags.push(...sw.flags);
  }
  if (!docs.some((d) => d.docType === 'packing_list'))
    flags.push({ severity: 'info', message: 'No packing list detected among the uploads — usually expected as a supporting document.' });

  // ---- Cross-checks ----
  if (inv && bl?.invoiceNumberRef && !bl.invoiceNumberRef.includes(inv.invoiceNumber) && !inv.invoiceNumber.includes(bl.invoiceNumberRef))
    flags.push({
      severity: 'warning',
      path: 'invoice.invoiceNumber',
      message: `Invoice number on BL ("${bl.invoiceNumberRef}") differs from invoice ("${inv.invoiceNumber}").`,
    });
  if (inv && coo?.invoiceNumberRef && !coo.invoiceNumberRef.replace(/\s/g, '').includes(inv.invoiceNumber.replace(/\s/g, '')))
    flags.push({
      severity: 'warning',
      path: 'invoice.invoiceNumber',
      message: `Invoice number on COO ("${coo.invoiceNumberRef}") differs from invoice ("${inv.invoiceNumber}").`,
    });
  const hsSources = [
    { source: 'invoice', value: inv?.items.find((i) => i.hsCode)?.hsCode },
    { source: 'transport doc', value: bl?.hsCode ?? awb?.hsCode },
    { source: 'COO', value: coo?.hsCode },
  ].filter((s): s is { source: string; value: string } => s.value != null);
  const hsAgree = new Set(hsSources.map((s) => s.value.replace(/\D/g, '').slice(0, 6)));
  if (hsAgree.size > 1)
    flags.push({
      severity: 'warning',
      path: 'items.0.ritc',
      message: `HS code differs across documents: ${hsSources.map((s) => `${s.value} (${s.source})`).join(', ')}.`,
    });
  for (const doc of docs) {
    const uncertain = (doc.data as { uncertainFields?: string[] } | null)?.uncertainFields ?? [];
    if (uncertain.length)
      flags.push({
        severity: 'warning',
        message: `${doc.fileName}: model unsure about ${uncertain.join(', ')} — verify against the document.`,
      });
  }

  // The packing list, read line by line and matched to the invoice.
  //
  // This is what gives an item a per-package weight, and a per-package weight
  // is the only way a partial ex-bond clearance can state the gross weight of
  // the packages it releases. Runs here, after unit normalisation, so the
  // quantity a release is apportioned against is the one the BE declares.
  const packed = attachPacking(items, pl);
  flags.push(...packed.flags);

  const draft: ChecklistDraft = {
    tenantId: chaProfile().tenantId,
    transportMode,
    // Home consumption until the customer's instruction says warehousing or
    // ex-bond; applyGeneralResolution reads that off the mail thread.
    beType: 'Home Consumption',
    // Custom station and filing status are deliberately absent here — see the
    // transport-mode and filing-status blocks above.
    importer,
    supplier: {
      name: meaningful(inv?.sellerName) ?? '',
      addressLines: inv?.sellerAddressLines ?? [],
      ...(inv?.sellerCity != null && { city: inv.sellerCity }),
      ...((inv?.sellerCountry ?? shipment.consCountry) != null && {
        country: inv?.sellerCountry ?? shipment.consCountry,
      }),
    },
    shipment,
    ...(hssChain.length && { hssChain }),
    invoiceMeta: {
      // Only the currencies this BE actually converts, so the EXCHANGE_RATE
      // sheet declares the rates it uses and no others.
      //
      // A currency with no notified rate is **left out**, not defaulted to 1.
      // It used to be `rates[c] ?? 1`, which made an unknown currency convert
      // at parity — every INR figure on the Bill of Entry silently wrong, and
      // the exporter's own "no exchange rate" blocker unreachable because the
      // key was always present. A missing key now reaches the bank-certificate
      // path, and failing that the blocker. See docs/boe-mapping/19-exchange-rate.md.
      //
      // The charges' currencies as well as the invoices'. ICES wants an
      // exchange row for the currency a freight, insurance or misc charge is
      // billed in even when no invoice uses it (220 / 227 / 234), and the
      // exporter asks for exactly that — so leaving them out here made it
      // refuse a Bill of Entry over a rate the notification does carry.
      // `ex_job29` is a GBP invoice with its freight certified in EUR.
      exchangeRates: Object.fromEntries(
        [
          ...new Set(
            invoices.flatMap((i) => [
              i.currency,
              i.freight?.currency,
              i.insurance?.kind === 'amount' ? i.insurance.value.currency : undefined,
              i.miscCharges?.currency,
            ]),
          ),
        ]
          .filter((c): c is string => !!c && c !== 'INR' && rates[c] != null)
          .map((c) => [c, rates[c]!]),
      ),
      ...(Object.keys(bankRateCertificates).length && { bankRateCertificates }),
    },
    invoices,
    items: packed.items,
    ...(cooDocs.length && {
      certificatesOfOrigin: cooDocs.map((c) => ({
        certificateNumber: c.certificateNumber,
        ...(c.issueDate != null && { issueDate: c.issueDate }),
        ...(c.issuingCountry != null && { issuingCountry: c.issuingCountry }),
        ...((c.originCountry ?? c.issuingCountry ?? shipment.countryOfOrigin) != null && {
          originCountry: (c.originCountry ?? c.issuingCountry ?? shipment.countryOfOrigin)!,
        }),
        ...(c.schemeText != null && { schemeText: c.schemeText }),
        ...(c.originCriterion != null && { originCriterion: c.originCriterion }),
        ...(c.producerName != null && { producerName: c.producerName }),
        ...(c.producerAddress != null && { producerAddress: c.producerAddress }),
        transitCountries: c.transitCountries ?? [],
        issuedRetroactively: c.issuedRetroactively ?? null,
        thirdPartyInvoicing: c.thirdPartyInvoicing ?? null,
        ...(c.invoiceNumberRef != null && { invoiceNumberRef: c.invoiceNumberRef }),
        items: (c.items ?? []).map((l) => ({
          ...(l.itemNumber != null && { itemNumber: l.itemNumber }),
          description: l.description,
          ...(l.hsCode != null && { hsCode: l.hsCode }),
          ...(l.originCriterion != null && { originCriterion: l.originCriterion }),
        })),
      })),
    }),
    singleWindowInfo,
    supportingDocs: docs.map((d) => ({ fileName: d.fileName, docType: d.docType })),
    // The distinct codes and their text, for the checklist. The scoped rows the
    // STATEMENT sheet files are derived again at export, from the draft as it
    // then stands.
    declarations: declarationTexts(
      declarationStatements({ invoices, items: packed.items, singleWindowInfo }),
    ),
    duty: null,
    fieldMeta,
    flags,
  };

  const resolved = resolveItems(draft, { today });

  // ---- Duty computation (only when we have enough to compute) ----
  try {
    const declaredValue = invoices.reduce((a, i) => a + i.invoiceValue, 0);
    if (items.length && declaredValue > 0) resolved.duty = computeBeDuty(toInvoiceInputs(resolved), rates);
  } catch (err) {
    resolved.flags.push({ severity: 'error', message: `Duty computation failed: ${(err as Error).message}` });
  }

  return resolved;
}
