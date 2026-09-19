import { ICES_ERRORS, icesError } from '@checklist/core';
import { ICES_RULES, validateIces } from '../src/validate/index.js';
import { BLANK, code, qty, text } from '../src/cell.js';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The ruleset that replaces Logi-Sys' uploader as our validator.
 *
 * Until this existed, every validation rule we owned had been learned by
 * uploading a workbook to Logi-Sys and reading the ErrorList it returned. That
 * is the vendor lock stated precisely: we could not file anywhere else, and we
 * could not find out how wrong we were without asking the vendor we are trying
 * to leave. ICES publishes its own codes; now we read them.
 */
describe('the published ICES rejection codes', () => {
  it('parses whole, and is pinned so a re-parse that loses rows fails loudly', () => {
    // 617 rows of `CACHI01 | ERR_CD | ERR_DESC | BE | F` in
    // BE_fresh_filing_error_codes_24032026.pdf. A silently short ruleset is
    // worse than none: a missing code reads as "ICES has no rule about this".
    expect(ICES_ERRORS).toHaveLength(617);
    expect(new Set(ICES_ERRORS.map((e) => e.code)).size).toBe(617);
  });

  it('keeps the source PDF clipping visible rather than inventing the rest', () => {
    // The PDF was rendered from a report with a fixed column width, so a long
    // description simply stops. These strings are what an operator reads when a
    // filing is rejected; completing them by guesswork would put words in
    // ICES' mouth.
    const clipped = ICES_ERRORS.filter((e) => e.truncated);
    expect(clipped.length).toBeGreaterThan(100);
    expect(icesError('180')).toMatchObject({
      description: 'Problem in Duty related parameters. Check',
      truncated: true,
    });
    expect(icesError('170')).toMatchObject({
      description: 'Container Details not Present',
      truncated: false,
    });
  });

  it('every ICES rule names a code ICES actually publishes', () => {
    for (const rule of ICES_RULES.filter((r) => r.source === 'ices'))
      expect(icesError(rule.code), `rule for ${rule.sheet}.${rule.column}`).toBeDefined();
  });
});

describe('what the validator catches', () => {
  const sheets = (over: Record<string, Record<string, ReturnType<typeof text>>[]>) => ({
    GENERAL: [],
    INVOICES: [],
    ITEMS: [],
    EXCHANGE_RATE: [],
    CONTAINERS: [],
    SUPPORTING_DOCS: [],
    SW_PRODUCTION: [],
    ...over,
  });

  it('a coded column outside its published set', () => {
    const { findings } = validateIces(
      sheets({ GENERAL: [{ TransportModeCode: code('SEA'), BETypeCode: code('H'), AdvancePriorNormal: code('N') }] }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ code: '112', sheet: 'GENERAL', column: 'TransportModeCode' }),
    );
    // And the two beside it, which are right, draw nothing.
    expect(findings.filter((f) => f.code === '101' || f.code === '113')).toHaveLength(0);
  });

  it('a currency used on an invoice with no row on the EXCHANGE_RATE sheet', () => {
    // ICES 209. Every rupee figure descends from that rate, so a missing row is
    // not a cosmetic gap.
    const { findings } = validateIces(
      sheets({
        INVOICES: [{ InvSrNo: code('1'), Inv_Currency: code('USD'), Frt_Currency: code('EUR') }],
        EXCHANGE_RATE: [{ CURRENCY_CODE: code('USD'), EXCHANGE_RATE: qty(96.8) }],
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({ code: '220', detail: expect.stringContaining('EUR') }),
    );
    expect(findings.filter((f) => f.code === '209')).toHaveLength(0);
  });

  it('a non-notified currency with only part of its bank block', () => {
    // ICES 155 wants the bank name, the certificate number and the certificate
    // date together, or none of them.
    const { findings } = validateIces(
      sheets({
        EXCHANGE_RATE: [
          {
            CURRENCY_CODE: code('THB'),
            EXCHANGE_RATE: qty(2.9),
            BANK_NAME: text('HDFC Bank'),
            BANK_CERTIFICATE: BLANK,
            BANK_CERTIFICATE_DATE: BLANK,
          },
        ],
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ code: '155', where: 'THB' }));
  });

  it('two rates for one currency', () => {
    const { findings } = validateIces(
      sheets({
        EXCHANGE_RATE: [
          { CURRENCY_CODE: code('USD'), EXCHANGE_RATE: qty(96.8) },
          { CURRENCY_CODE: code('USD'), EXCHANGE_RATE: qty(95.25) },
        ],
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ code: '176', where: 'USD' }));
  });

  it('containers on an air consignment', () => {
    const { findings } = validateIces(
      sheets({
        GENERAL: [{ TransportModeCode: code('A') }],
        CONTAINERS: [{ ContainerSize: code('40') }],
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ code: '121' }));
  });

  it('a CTH and an RITC that disagree', () => {
    const { findings } = validateIces(
      sheets({
        ITEMS: [
          {
            InvSrNo: code('1'),
            ItemSrNo: code('1'),
            CTH: code('34039900'),
            RITC: code('34031900'),
            CETH: code('34039900'),
            Product_Description: text('gel'),
            Unit: code('NOS'),
            QTY: qty(10),
            Unit_Price: qty(358.32),
            Country_of_Origin: code('US'),
          },
        ],
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ code: '350' }));
  });

  it('an invoice with no line against it', () => {
    const { findings } = validateIces(
      sheets({
        INVOICES: [{ InvSrNo: code('1'), Invoice_No: text('MA-1'), Inv_Currency: code('INR') }],
        ITEMS: [],
      }),
    );
    expect(findings).toContainEqual(expect.objectContaining({ code: '258' }));
  });

  it('says nothing about a workbook that is right', () => {
    const { findings } = validateIces(
      sheets({
        GENERAL: [
          {
            TransportModeCode: code('S'),
            BETypeCode: code('H'),
            AdvancePriorNormal: code('N'),
            Importer: text('A-ONE CHEM-TRADE PRIVATE LIMITED'),
            AD_Code: code('0510007'),
            CountryOfOriginCode: code('CN'),
            CountryOfShipmentCode: code('CN'),
            PortOfShipmentCode: code('CNTAO'),
          },
        ],
        INVOICES: [
          {
            InvSrNo: code('1'),
            Invoice_No: text('MA-104025'),
            Invoice_Date: text('12-Jul-2025'),
            Supplier_Name: text('SHANGHAI CHUANBAI CHEMICAL CO., LTD'),
            Product_Value: qty(89800),
            Inv_Currency: code('USD'),
            TOI: code('CIF'),
          },
        ],
        ITEMS: [
          {
            InvSrNo: code('1'),
            ItemSrNo: code('1'),
            Product_Description: text('Sodium formate'),
            QTY: qty(100),
            Unit_Price: qty(898),
            Unit: code('KGS'),
            Country_of_Origin: code('CN'),
            RITC: code('25199040'),
            CTH: code('25199040'),
            CETH: code('25199040'),
          },
        ],
        EXCHANGE_RATE: [
          { CURRENCY_CODE: code('INR'), EXCHANGE_RATE: qty(1) },
          { CURRENCY_CODE: code('USD'), EXCHANGE_RATE: qty(86.2) },
        ],
      }),
    );
    expect(findings.filter((f) => f.source === 'ices')).toEqual([]);
  });
});

describe('ErrorList.htm — the upload that taught us everything we knew', () => {
  /**
   * The Logi-Sys uploader's reply to the first real upload, kept verbatim in
   * `test/fixtures/`. Each message is `SHEET : COLUMN : [scope] : reason`.
   *
   * The acceptance criterion for this phase: every one of them is either
   * explained by a rule we now own, or explicitly recorded as vendor-only.
   * Nothing is left as "we do not know why that happened".
   */
  const messages = readFileSync(path.join(__dirname, 'fixtures/ErrorList.htm'), 'utf8')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(' : '));

  it('reads 42 errors across 18 columns', () => {
    expect(messages).toHaveLength(42);
    const pairs = new Set(messages.map((m) => m.split(' : ').slice(0, 2).map((s) => s.trim()).join('.')));
    expect(pairs.size).toBe(18);
  });

  it('every column it complained about is covered by a rule', () => {
    const covered = new Set(ICES_RULES.map((r) => `${r.sheet}.${r.column}`));
    const unexplained = [
      ...new Set(messages.map((m) => m.split(' : ').slice(0, 2).map((s) => s.trim()).join('.'))),
    ].filter((p) => !covered.has(p));
    expect(unexplained).toEqual([]);
  });

  it('splits them the way the exit depends on: ICES to file, Logi-Sys to hand over', () => {
    const pairs = [
      ...new Set(messages.map((m) => m.split(' : ').slice(0, 2).map((s) => s.trim()).join('.'))),
    ];
    const sourcesFor = (pair: string) =>
      new Set(ICES_RULES.filter((r) => `${r.sheet}.${r.column}` === pair).map((r) => r.source));

    // Thirteen of the eighteen columns their uploader complained about are
    // requirements ICES does not have: ten SUPPORTING_DOCS columns where the
    // eSanchit IRN is the whole pointer, and three SW_PRODUCTION dates. They
    // stop mattering the day the handoff does.
    const vendorOnly = pairs.filter((p) => sourcesFor(p).has('logisys') && !sourcesFor(p).has('ices'));
    expect(vendorOnly).toHaveLength(13);

    // Three are real ICES rules and we simply got them wrong.
    const icesOnly = pairs.filter((p) => sourcesFor(p).has('ices') && !sourcesFor(p).has('logisys'));
    expect(icesOnly.sort()).toEqual([
      'GENERAL.AdvancePriorNormal',
      'GENERAL.BETypeCode',
      'ITEMS.CETH',
    ]);

    // And two are the interesting case: ICES has a rule, and Logi-Sys has a
    // *different, stricter* one for the same column. Reading only the vendor's
    // reply taught us their spelling and hid ICES'.
    const both = pairs.filter((p) => sourcesFor(p).has('ices') && sourcesFor(p).has('logisys'));
    expect(both.sort()).toEqual(['GENERAL.TransportModeCode', 'INVOICES.TOI']);
  });

  it('the two where the vendor and ICES disagree, stated', () => {
    // Mode of transport: ICES takes L/S/A (BE Message format 2.25 field 17);
    // their uploader said "Expected values are 'A' for Air and 'S' for Sea".
    // Three corpus jobs are land consignments — valid filings their uploader
    // would refuse.
    const land = validateIces({ GENERAL: [{ TransportModeCode: code('L') }] });
    expect(land.findings.filter((f) => f.source === 'ices')).toEqual([]);
    expect(land.findings.filter((f) => f.source === 'logisys')).toHaveLength(1);

    // Terms of invoice: ICES spells them `CIF CF CI FOB` (field 42); their
    // uploader wants the ampersand. We write the vendor's spelling today, so
    // a direct filing would be rejected — found here rather than by an upload.
    const vendorSpelling = validateIces({ INVOICES: [{ InvSrNo: code('1'), TOI: code('C&F') }] });
    expect(vendorSpelling.findings.filter((f) => f.source === 'ices')).toContainEqual(
      expect.objectContaining({ code: '207' }),
    );
    expect(vendorSpelling.findings.filter((f) => f.source === 'logisys')).toEqual([]);
  });

  it('does not fire on the NOEXCISE sentinel ICES asks for', () => {
    // Since GST there are goods with no central excise heading, and the spec
    // says to quote "NOEXCISE". Comparing that to a CTH made rule 336 fire on
    // every line of all 26 exporting jobs — 136 findings, none of them real.
    const { findings } = validateIces({
      ITEMS: [
        {
          InvSrNo: code('1'),
          ItemSrNo: code('1'),
          CTH: code('34039900'),
          RITC: code('34039900'),
          CETH: code('NOEXCISE'),
        },
      ],
    });
    expect(findings.filter((f) => f.code === '336')).toEqual([]);
  });
});
