import { VALID_UQC } from '@checklist/core';
import type { Cell } from '../cell.js';
import type { IcesRule, SheetData } from './types.js';
import type { SheetRow } from '../sheet-writer.js';

/**
 * The first tranche of ICES rejection rules, plus the Logi-Sys-only ones we
 * learned the hard way.
 *
 * Every rule names the published `ERR_CD` it enforces, so a finding can be read
 * straight against `BE_fresh_filing_error_codes_24032026.pdf`. This is
 * deliberately not all 617: most of them are about state ICES holds and we
 * cannot see (is the IEC blacklisted, is the CHA licence current, does the
 * warehouse ledger have a credit entry), or about sheets we do not map. What is
 * here is what can be decided from the workbook alone.
 *
 * A rule that cannot be decided from the workbook does not belong here at all.
 * Guessing at ICES' server-side state would produce findings nobody can act on,
 * which is how a validator stops being read.
 */

function value(row: SheetRow, column: string): string {
  const cell: Cell | undefined = row[column];
  return cell && cell.kind === 'text' ? cell.value : '';
}

function rows(data: SheetData, sheet: string): SheetRow[] {
  return data[sheet] ?? [];
}

/** `Invoice #1 Item #2`, from whichever of the two serials the row carries. */
function where(row: SheetRow): string {
  const inv = value(row, 'InvSrNo');
  const item = value(row, 'ItemSrNo');
  if (inv && item) return `Invoice #${inv} Item #${item}`;
  if (inv) return `Invoice #${inv}`;
  return '';
}

/** A rule over every row of one sheet. */
function perRow(
  code: string,
  sheet: string,
  column: string,
  fail: (row: SheetRow, data: SheetData) => string | null,
  opts: { source?: IcesRule['source']; reads?: string[] } = {},
): IcesRule {
  return {
    code,
    source: opts.source ?? 'ices',
    sheet,
    column,
    reads: opts.reads ?? [column],
    check: (data) =>
      rows(data, sheet).flatMap((row) => {
        const detail = fail(row, data);
        return detail ? [{ where: where(row), detail }] : [];
      }),
  };
}

/** A coded column that must hold one of a fixed set of values. */
function oneOf(
  code: string,
  sheet: string,
  column: string,
  allowed: string[],
  opts: { source?: IcesRule['source'] } = {},
): IcesRule {
  const who = opts.source === 'logisys' ? "Logi-Sys' uploader accepts" : 'ICES accepts';
  return perRow(
    code,
    sheet,
    column,
    (row) => {
      const v = value(row, column);
      if (!v) return null; // emptiness is a different code; see the mandatory rules
      return allowed.includes(v) ? null : `wrote ${JSON.stringify(v)}; ${who} ${allowed.join(' / ')}`;
    },
    opts,
  );
}

/** A column that must carry something. */
function mandatory(
  code: string,
  sheet: string,
  column: string,
  opts: { source?: IcesRule['source'] } = {},
): IcesRule {
  return perRow(code, sheet, column, (row) => (value(row, column) ? null : 'is blank'), opts);
}

/** A column that must parse as a number strictly greater than zero. */
function positive(code: string, sheet: string, column: string): IcesRule {
  return perRow(code, sheet, column, (row) => {
    const v = value(row, column);
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return `wrote ${JSON.stringify(v)}, which is not a number`;
    return n > 0 ? null : `wrote ${v}; ICES rejects zero and negative`;
  });
}

/** Currencies the EXCHANGE_RATE sheet declares a rate for. */
function declaredCurrencies(data: SheetData): Set<string> {
  return new Set(rows(data, 'EXCHANGE_RATE').map((r) => value(r, 'CURRENCY_CODE')).filter(Boolean));
}

/**
 * A charge currency with no EXCHANGE_RATE row of its own.
 *
 * ICES gives this its own code per charge — 209 for the invoice, 220 freight,
 * 227 insurance, 234 misc, 241 loading, 248 agency commission — because the
 * row is missing for a different reason each time.
 */
function exchangeDetails(code: string, column: string): IcesRule {
  return perRow(
    code,
    'INVOICES',
    column,
    (row, data) => {
      const currency = value(row, column);
      if (!currency || currency === 'INR') return null;
      return declaredCurrencies(data).has(currency)
        ? null
        : `${currency} is used here and has no row on the EXCHANGE_RATE sheet`;
    },
    { reads: [column] },
  );
}

export const ICES_RULES: IcesRule[] = [
  // ------------------------------------------------------------ GENERAL ----
  oneOf('101', 'GENERAL', 'BETypeCode', ['H', 'I', 'E', 'Z', 'M', 'T', 'V', 'S']),
  // L/S/A — Land, Sea, Air (BE Message format 2.25, CACHI01 field 17). Logi-Sys'
  // uploader accepts only A and S, which is *their* restriction, not ICES': three
  // corpus jobs are land consignments their uploader would refuse and ICES
  // would take. That divergence is the reason the two rule sets are separate.
  oneOf('112', 'GENERAL', 'TransportModeCode', ['L', 'S', 'A']),
  oneOf('113', 'GENERAL', 'AdvancePriorNormal', ['A', 'P', 'N']),
  mandatory('105', 'GENERAL', 'Importer'),
  perRow('144', 'GENERAL', 'AD_Code', (row) => {
    const v = value(row, 'AD_Code');
    if (!v) return null;
    // Seven digits, leading zero and all — `0510226` as a number is 510226,
    // which is a different bank branch.
    return /^\d{7}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; an AD code is seven digits`;
  }),
  perRow('107', 'GENERAL', 'CountryOfOriginCode', (row) => {
    const v = value(row, 'CountryOfOriginCode');
    if (!v) return null;
    return /^[A-Z]{2}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; ICES wants the two-letter code`;
  }),
  perRow('108', 'GENERAL', 'CountryOfShipmentCode', (row) => {
    const v = value(row, 'CountryOfShipmentCode');
    if (!v) return null;
    return /^[A-Z]{2}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; ICES wants the two-letter code`;
  }),
  perRow('106', 'GENERAL', 'PortOfShipmentCode', (row) => {
    const v = value(row, 'PortOfShipmentCode');
    if (!v) return null;
    return /^[A-Z]{2}[A-Z0-9]{3}$/.test(v)
      ? null
      : `wrote ${JSON.stringify(v)}; a port of shipment is a five-character UN/LOCODE`;
  }),

  // ----------------------------------------------------------- INVOICES ----
  mandatory('201', 'INVOICES', 'InvSrNo'),
  mandatory('202', 'INVOICES', 'Invoice_No'),
  mandatory('203', 'INVOICES', 'Invoice_Date'),
  mandatory('204', 'INVOICES', 'Supplier_Name'),
  positive('205', 'INVOICES', 'Product_Value'),
  mandatory('206', 'INVOICES', 'Inv_Currency'),
  // ICES spells these `CIF CF CI FOB` (BE Message format 2.25, field 42).
  // Logi-Sys' uploader wants `C&F` and `C&I`, with the ampersand. We currently
  // write the vendor's spelling, which ICES would reject outright — one for
  // Phase 1, and found by this validator rather than by an upload.
  oneOf('207', 'INVOICES', 'TOI', ['FOB', 'CIF', 'CF', 'CI']),
  exchangeDetails('209', 'Inv_Currency'),
  exchangeDetails('220', 'Frt_Currency'),
  exchangeDetails('227', 'Ins_Currency'),
  exchangeDetails('234', 'Misc_Charge_Currency'),
  exchangeDetails('241', 'Loading_Currency'),
  exchangeDetails('248', 'Agency_Currency'),
  {
    // 258 — an invoice with no line against it. The BE would declare a sale and
    // then declare nothing sold.
    code: '258',
    source: 'ices',
    sheet: 'INVOICES',
    column: 'InvSrNo',
    reads: ['InvSrNo'],
    check: (data) => {
      const withItems = new Set(rows(data, 'ITEMS').map((r) => value(r, 'InvSrNo')));
      return rows(data, 'INVOICES')
        .filter((r) => value(r, 'InvSrNo') && !withItems.has(value(r, 'InvSrNo')))
        .map((r) => ({
          where: where(r),
          detail: 'the INVOICES sheet declares this invoice and the ITEMS sheet has no line for it',
        }));
    },
  },

  // -------------------------------------------------------------- ITEMS ----
  mandatory('301', 'ITEMS', 'InvSrNo'),
  mandatory('302', 'ITEMS', 'ItemSrNo'),
  mandatory('306', 'ITEMS', 'Product_Description'),
  positive('308', 'ITEMS', 'QTY'),
  positive('310', 'ITEMS', 'Unit_Price'),
  perRow('311', 'ITEMS', 'Unit', (row) => {
    const v = value(row, 'Unit');
    if (!v) return null;
    return VALID_UQC.has(v) ? null : `wrote ${JSON.stringify(v)}, which is not an ICES UQC`;
  }),
  perRow('314', 'ITEMS', 'Country_of_Origin', (row) => {
    const v = value(row, 'Country_of_Origin');
    if (!v) return null;
    return /^[A-Z]{2}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; ICES wants the two-letter code`;
  }),
  perRow('315', 'ITEMS', 'RITC', (row) => {
    const v = value(row, 'RITC');
    if (!v) return 'is blank; nothing can be assessed without a tariff item';
    return /^\d{8}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; an RITC is eight digits`;
  }),
  perRow('316', 'ITEMS', 'CTH', (row) => {
    const v = value(row, 'CTH');
    if (!v) return null;
    return /^\d{8}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; a CTH is eight digits`;
  }),
  // 317 is the one Logi-Sys' uploader caught on the very first upload:
  // "ITEMS : CETH : Invoice No. #1 Product No. #1 This field is mandatory".
  mandatory('317', 'ITEMS', 'CETH'),
  perRow(
    '336',
    'ITEMS',
    'CETH',
    (row) => {
      const cth = value(row, 'CTH');
      const ceth = value(row, 'CETH');
      if (!cth || !ceth) return null;
      // Since GST there are goods with no central excise heading at all, and
      // ICES says so itself: "User has to quote 'NOEXCISE' for such items" (BE
      // Message format 2.25, item notes). Comparing that sentinel's first four
      // characters to a CTH is meaningless, and doing so made this rule fire on
      // every line of all 26 exporting jobs.
      if (ceth === 'NOEXCISE') return null;
      return cth.slice(0, 4) === ceth.slice(0, 4)
        ? null
        : `CTH ${cth} and CETH ${ceth} disagree in the first four digits`;
    },
    { reads: ['CTH', 'CETH'] },
  ),
  perRow(
    '350',
    'ITEMS',
    'RITC',
    (row) => {
      const cth = value(row, 'CTH');
      const ritc = value(row, 'RITC');
      if (!cth || !ritc) return null;
      return cth === ritc ? null : `CTH ${cth} and RITC ${ritc} do not match`;
    },
    { reads: ['CTH', 'RITC'] },
  ),

  // ------------------------------------------------------ EXCHANGE_RATE ----
  perRow('151', 'EXCHANGE_RATE', 'CURRENCY_CODE', (row) => {
    const v = value(row, 'CURRENCY_CODE');
    if (!v) return 'is blank';
    return /^[A-Z]{3}$/.test(v) ? null : `wrote ${JSON.stringify(v)}; a currency code is three letters`;
  }),
  positive('156', 'EXCHANGE_RATE', 'EXCHANGE_RATE'),
  {
    // 155 — a currency the Ministry of Finance does not notify is "non-standard",
    // and the importer's bank certifies the rate instead. All three bank columns
    // are then mandatory.
    code: '155',
    source: 'ices',
    sheet: 'EXCHANGE_RATE',
    column: 'BANK_NAME',
    reads: ['BANK_NAME', 'BANK_CERTIFICATE', 'BANK_CERTIFICATE_DATE'],
    check: (data) =>
      rows(data, 'EXCHANGE_RATE').flatMap((row) => {
        const bank = ['BANK_NAME', 'BANK_CERTIFICATE', 'BANK_CERTIFICATE_DATE'];
        const present = bank.filter((c) => value(row, c));
        if (present.length === 0 || present.length === bank.length) return [];
        return [
          {
            where: value(row, 'CURRENCY_CODE'),
            detail:
              `only ${present.join(', ')} ${present.length === 1 ? 'is' : 'are'} filled. ` +
              'For a non-notified currency ICES needs the bank name, the certificate number ' +
              'and the certificate date together, or none of them.',
          },
        ];
      }),
  },
  {
    // 176 — two rows for one currency. The BE would carry two rates and ICES
    // would pick one of them.
    code: '176',
    source: 'ices',
    sheet: 'EXCHANGE_RATE',
    column: 'CURRENCY_CODE',
    reads: ['CURRENCY_CODE'],
    check: (data) => {
      const seen = new Map<string, number>();
      for (const r of rows(data, 'EXCHANGE_RATE')) {
        const c = value(r, 'CURRENCY_CODE');
        if (c) seen.set(c, (seen.get(c) ?? 0) + 1);
      }
      return [...seen]
        .filter(([, n]) => n > 1)
        .map(([c, n]) => ({ where: c, detail: `${n} rows declare a rate for ${c}` }));
    },
  },

  // --------------------------------------------------------- CONTAINERS ----
  {
    // 121 — an air consignment has no containers, and ICES rejects a BE that
    // claims otherwise.
    code: '121',
    source: 'ices',
    sheet: 'CONTAINERS',
    column: '',
    reads: [],
    check: (data) => {
      const air = rows(data, 'GENERAL').some((r) => value(r, 'TransportModeCode') === 'A');
      const n = rows(data, 'CONTAINERS').length;
      return air && n
        ? [{ where: '', detail: `the mode of transport is Air and the sheet carries ${n} containers` }]
        : [];
    },
  },

  // ---------------------------------------- Logi-Sys' uploader, not ICES ----
  //
  // Learned from ErrorList.htm, the first real upload. These are the vendor's
  // own requirements: their uploader makes columns mandatory that ICES treats
  // as optional, so they are labelled and counted apart. They stop mattering
  // the day the handoff does.
  // Their uploader takes only Air and Sea, where ICES takes Land too.
  oneOf('GENERAL.TransportModeCode', 'GENERAL', 'TransportModeCode', ['A', 'S'], {
    source: 'logisys',
  }),
  // And spells the terms of invoice with an ampersand where ICES does not.
  oneOf('INVOICES.TOI', 'INVOICES', 'TOI', ['FOB', 'CIF', 'C&F', 'C&I'], { source: 'logisys' }),
  mandatory('SW_PRODUCTION.Prod_Manufacturer_Date', 'SW_PRODUCTION', 'Prod_Manufacturer_Date', {
    source: 'logisys',
  }),
  mandatory('SW_PRODUCTION.Prod_Expiry_Date', 'SW_PRODUCTION', 'Prod_Expiry_Date', {
    source: 'logisys',
  }),
  mandatory('SW_PRODUCTION.Prod_Best_before_Date', 'SW_PRODUCTION', 'Prod_Best_before_Date', {
    source: 'logisys',
  }),
  // The ten SUPPORTING_DOCS columns their uploader makes mandatory. ICES treats
  // every one of them as optional — the IRN is the pointer, and eSanchit
  // already holds the issuing and beneficiary particulars against it. We fill
  // none of them today (the sheet scores 0%), so this list is the exact price
  // of the handoff and nothing more.
  ...[
    'Item_SrNo',
    'Doc_IRN',
    'Doc_Upload_DateTime',
    'Reference_No.',
    'Doc_Issued_At',
    'Doc_Issued_Date',
    'Doc_Issuing_Party_Name',
    'Doc_Issuing_Party_Add1',
    'Doc_Beneficiary_Party_Name',
    'Doc_Beneficiary_Party_Add1',
  ].map((column) =>
    mandatory(`SUPPORTING_DOCS.${column}`, 'SUPPORTING_DOCS', column, { source: 'logisys' }),
  ),
];
