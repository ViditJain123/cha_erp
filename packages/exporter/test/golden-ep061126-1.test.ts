import { beforeAll, describe, expect, it } from 'vitest';
import { buildLogisysWorkbook } from '../src/build.js';
import { EP061126_1_DRAFT, EP061126_1_JOB } from './fixtures/ep061126-1.js';
import { openWorkbook, readSheet } from './read.js';

/**
 * Golden test: job EP061126-1, filed by Logi-Sys as I-13844/26-27.
 *
 * Expected values are transcribed from the checklist Logi-Sys itself produced
 * (`ex_job6/Import CheckList-I-1384426-27-08-AUG-2026_12_14_PM.pdf`) and the
 * shipping documents beside it, following the convention of
 * packages/core/test/golden-job1.test.ts.
 *
 * This job was first keyed into the template by hand and rejected. Several
 * assertions below name the specific mistake they guard against, because those
 * are the ones a future change is most likely to reintroduce.
 */
describe('golden: EP061126-1 / I-13844/26-27 (sea, Nhava Sheva, Japan CEPA)', () => {
  let workbook: Buffer;
  let warnings: string[];

  beforeAll(async () => {
    const result = await buildLogisysWorkbook({
      draft: EP061126_1_DRAFT,
      job: EP061126_1_JOB,
    });
    workbook = result.buffer;
    warnings = result.warnings;
  });

  describe('GENERAL', () => {
    it('carries the header of the Bill of Entry', async () => {
      const [row] = await readSheet(workbook, 'GENERAL');
      expect(row).toBeDefined();
      expect(row!['CustomsHouseCode']).toBe('INNSA1');
      // Single letters, not the labels the Logi-Sys screens show: its upload
      // validator rejected SEA/HOME/ADVANCE outright.
      expect(row!['TransportModeCode']).toBe('S');
      expect(row!['BETypeCode']).toBe('H');
      expect(row!['AdvancePriorNormal']).toBe('A');
      expect(row!['DutyPaymentStatus_T_D']).toBe('T');
      expect(row!['Importer_RefNo']).toBe('EP061126-1');
    });

    it('keeps the AD code a string so its leading zero survives', async () => {
      // Keyed by hand this became 510226 — a different bank branch.
      const [row] = await readSheet(workbook, 'GENERAL');
      expect(row!['AD_Code']).toBe('0510226');
      expect(typeof row!['AD_Code']).toBe('string');
    });

    it('writes country and port as codes, not names', async () => {
      // The three cells that read JAPAN / YOKOHAMA / JAPAN on the manual attempt.
      const [row] = await readSheet(workbook, 'GENERAL');
      expect(row!['CountryOfOriginCode']).toBe('JP');
      expect(row!['PortOfShipmentCode']).toBe('JPYOK');
      expect(row!['CountryOfShipmentCode']).toBe('JP');
    });

    it('leaves the boolean flags empty, the way Logi-Sys writes them', async () => {
      // These were "N". A workbook Logi-Sys exported itself leaves all ten
      // empty, and so does the corrected workbook accepted for job ce9c889d.
      const [row] = await readSheet(workbook, 'GENERAL');
      for (const column of [
        'IsUnderSec46',
        'IsUnderSec48',
        'IsFirstCheck',
        'IsGreenChannel',
        'IsKachchaBE',
        'IsHSS',
        'IsBondsCertificates',
        'IsTranshipment',
        'IsUnderProvisionalAssessment',
      ]) {
        expect(row![column] ?? '').toBe('');
      }
    });

    it('is a single row', async () => {
      expect(await readSheet(workbook, 'GENERAL')).toHaveLength(1);
    });
  });

  describe('SHIPMENT', () => {
    it('carries the B/L and the vessel', async () => {
      const [row] = await readSheet(workbook, 'SHIPMENT');
      expect(row!['MAWB_MBL_No']).toBe('A07GX14312');
      expect(row!['VesselName']).toBe('INTERASIA TENACITY');
      expect(row!['FlightNo_VoyageNo']).toBe('S022');
      expect(row!['CarrierName']).toBe('INTERASIA LINES');
      expect(row!['Marks_&_Nos']).toBe('AS PER BL');
      expect(row!['Port_of_Reporting']).toBe('INNSA1');
    });

    it('dates the B/L when it was issued, as text', async () => {
      // The manual attempt wrote a raw Excel serial for today's date (46242)
      // instead of the B/L date.
      const [row] = await readSheet(workbook, 'SHIPMENT');
      expect(row!['AWB_BL_Date']).toBe('30-Jun-2026');
      expect(typeof row!['AWB_BL_Date']).toBe('string');
    });

    it('declares both weights, as text at three decimals', async () => {
      // Logi-Sys writes "4000.000" packages and "100400.000" gross on its own
      // export, so a package count carries three decimals like a weight does.
      const [row] = await readSheet(workbook, 'SHIPMENT');
      expect(row!['No_of_Pkg']).toBe('6258.000');
      expect(row!['PkgUnitCode']).toBe('BAG');
      expect(row!['GrWt']).toBe('157703.000');
      expect(row!['GrWtUnitCode']).toBe('KGS');
      expect(row!['NtWt']).toBe('156450.000');
      expect(row!['NtWtUnitCode']).toBe('KGS');
      expect(typeof row!['GrWt']).toBe('string');
    });
  });

  describe('CONTAINERS', () => {
    it('declares all six containers', async () => {
      // The manual attempt carried one. A BE that declares one of six
      // containers is not a smaller filing, it is a wrong one.
      const rows = await readSheet(workbook, 'CONTAINERS');
      expect(rows).toHaveLength(6);
      expect(rows.map((r) => r['Container No'])).toEqual([
        'IAAU1730986',
        'IAAU1868002',
        'IAAU1947945',
        'IAAU1957028',
        'IAAU1818697',
        'IAAU1141498',
      ]);
    });

    it('numbers every container against the IGM', async () => {
      // Mandatory, and nothing we read carries it — leaving it blank is what
      // Logi-Sys rejected job dbf3530c on, four errors for four containers.
      const rows = await readSheet(workbook, 'CONTAINERS');
      expect(rows.map((r) => r['IGM Sr.No'])).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(warnings.some((w) => w.startsWith('CONTAINERS.IGM Sr.No'))).toBe(true);
    });

    it('carries each container’s seal', async () => {
      const rows = await readSheet(workbook, 'CONTAINERS');
      expect(rows.map((r) => r['Seal No'])).toEqual([
        'IAAH479538',
        'IAAH479537',
        'IAAH479581',
        'IAAH498433',
        'IAAH479522',
        'IAAH479523',
      ]);
    });

    it('splits the B/L’s "40SD96" into size and type', async () => {
      const rows = await readSheet(workbook, 'CONTAINERS');
      for (const row of rows) {
        expect(row['ContainerSize']).toBe('40');
        // ISO 6346, not the two-letter group: Logi-Sys' own export writes
        // "22G1" against a size of "20", so a 40' high cube is "45G1".
        expect(row['ContainerTypeCode']).toBe('45G1');
        expect(row['FCL_LCL']).toBe('FCL');
      }
    });

    it('carries the packing list’s per-container stuffing', async () => {
      const rows = await readSheet(workbook, 'CONTAINERS');
      expect(rows[0]!['PackagesStuffed']).toBe('1043');
      expect(rows.reduce((sum, r) => sum + Number(r['PackagesStuffed'] ?? 0), 0)).toBe(6258);
    });
  });

  describe('INVOICES', () => {
    it('carries the invoice', async () => {
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['InvSrNo']).toBe('1');
      expect(row!['Invoice_No']).toBe('ASI-EP061126-1');
      expect(row!['Invoice_Date']).toBe('30-Jun-2026');
      expect(row!['Inv_Currency']).toBe('USD');
      expect(row!['Product_Value']).toBe('188924.33');
    });

    it('declares cost-and-freight, not CIF', async () => {
      // The manual attempt wrote CIF. CIF includes insurance and C&F does not,
      // so the two produce different assessable values. Logi-Sys spells
      // cost-and-freight "C&F"; it rejects CFR.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['TOI']).toBe('C&F');
    });

    it('carries insurance as a percentage, with no amount', async () => {
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Ins_%']).toBe('1.1250');
      // The percentage and the amount used to be mutually exclusive here, with
      // the amount left blank. They are no longer: Logi-Sys writes the whole
      // charge block as explicit zeros on its own export, so a percentage-insured
      // invoice now carries "0.00" alongside it. "0.00" is not a competing
      // amount, but the exclusivity that this test used to assert is gone.
      expect(row!['Ins_Amount']).toBe('0.00');
    });

    it('carries the supplier with a coded country', async () => {
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Supplier_Name']).toBe('ASIA SHIGEN INTERNATIONAL CO., LTD');
      expect(row!['Supplier_City']).toBe('Shizuoka');
      expect(row!['Supplier_Country_Code']).toBe('JP');
      expect(row!['Is_Related']).toBe('N');
      expect(String(row!['Supplier_Address'])).toContain('HAMAMATSU SHI');
    });

    it('names the valuation rule rather than the draft\'s bare word', async () => {
      // The draft says "Transaction" and that was written straight through.
      // Logi-Sys wants the rule from the Customs Valuation Rules 2007.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Valuation_Method']).toBe('RULE 4 (TRANSACTION VALUE)');
    });

    it('writes OTHERS in both terms-of-payment columns', async () => {
      // Terms_of_Payment is a dropdown in Logi-Sys, and the remark beside it
      // is not a place for the invoice's wording — the vendor's own export
      // writes OTHERS in both.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Terms_of_Payment']).toBe('OTHERS');
      expect(row!['Other_Terms_of_Payment_Remark']).toBe('OTHERS');
    });

    it('declares nil miscellaneous charges and no custom house', async () => {
      // Both are repeat mistakes. Logi-Sys' own export writes the misc block
      // as 0.0000 / 0.00 with no currency, and leaves Custom_House_Code empty
      // — the station belongs on GENERAL.CustomsHouseCode.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Misc_Charge_%']).toBe('0.0000');
      expect(row!['Misc_Charge_Amount']).toBe('0.00');
      expect(row!['Misc_Charge_Currency'] ?? '').toBe('');
      expect(row!['Custom_House_Code'] ?? '').toBe('');
    });

    it('writes the revenue deposit pair rather than leaving it empty', async () => {
      // "RD" is Revenue Deposit — Invoice -> Other Charges reads
      // "Revenue Deposit __ % on [Assessable]". Two decimals, not the four the
      // charge block above uses.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['RD_%']).toBe('0.00');
      expect(row!['RD_Basis']).toBe('A');
    });

    it('declares one charge block for the whole Bill of Entry', async () => {
      // Invoice -> Other Charges, "Single Freight, Insurance & other charges
      // for all Invoices". The draft models one invoice and one set of charges,
      // which is what that box says; it was hardcoded N.
      const [row] = await readSheet(workbook, 'INVOICES');
      expect(row!['Is_Single_Frt_Ins_Other_Chrg']).toBe('Y');
    });
  });

  describe('ITEMS', () => {
    it('declares the one line', async () => {
      const rows = await readSheet(workbook, 'ITEMS');
      expect(rows).toHaveLength(1);
      expect(rows[0]!['InvSrNo']).toBe('1');
      expect(rows[0]!['ItemSrNo']).toBe('1');
      expect(rows[0]!['Product_Description']).toBe('PP GRANULES (POLYPROPYLENE)');
    });

    it('pads the invoice’s 3902.10 to an 8-digit tariff line', async () => {
      // Right-padded: 39021000. Padding left would give 00390210, which is
      // not a tariff line. The manual attempt typed 39021010.
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['CTH']).toBe('39021000');
      expect(row!['RITC']).toBe('39021000');
      expect(typeof row!['CTH']).toBe('string');
    });

    it('states quantity and unit price in the same units', async () => {
      // The invoice reads 156.450 MT at 1,207.57/MT; the BE reads 156450 KGS
      // at 1.20757. Rescaling one without the other overstates the line 1000x,
      // which build.ts refuses outright.
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['QTY']).toBe('156450.000000');
      expect(row!['Unit']).toBe('KGS');
      expect(row!['Unit_Price']).toBe('1.207570');
      expect(Number(row!['QTY']) * Number(row!['Unit_Price'])).toBeCloseTo(188924.33, 1);
    });

    it('carries the trade description and origin', async () => {
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['General_Description']).toBe('PP PELLET (POLYPROPYLENE)');
      expect(row!['Brand']).toBe('UNBRANDED');
      expect(row!['Model']).toBe('NA');
      expect(row!['CETH']).toBe('NOEXCISE');
      expect(row!['End_Use']).toBe('GNX100');
      expect(row!['Country_of_Origin']).toBe('JP');
    });

    it('carries every notification with its serial', async () => {
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['Basic_Notn']).toBe('069/2011');
      expect(row!['Basic_NotnSrNo']).toBe('295');
      expect(row!['AIDC_LevyNotn']).toBe('011/2021');
      expect(row!['AIDC_LevyNotnSrNo']).toBe('19');
      expect(row!['IGST_LevyNotn']).toBe('009/2025');
      expect(row!['IGST_LevyNotnSrNo']).toBe('II114');
      expect(row!['IGST_CompCessNotn']).toBe('001/2017');
      expect(row!['IGST_CompCessNotnSrNo']).toBe('56');
    });

    it('keeps notification numbers as text', async () => {
      // "069/2011" as anything but text is a date or a fraction.
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(typeof row!['Basic_Notn']).toBe('string');
      expect(typeof row!['IGST_LevyNotnSrNo']).toBe('string');
    });

    it('carries the manufacturer', async () => {
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['MFG_Name']).toBe('ASIA SHIGEN INTERNATIONAL CO., LTD');
      expect(String(row!['MFG_Address'])).toContain('MOTOSHIRO-CHO');
      expect(row!['MFG_Country']).toBe('JP');
    });

    it('claims the CEPA preference', async () => {
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['isFTAbenefitClaimed']).toBe('Y');
      expect(row!['Standard_Preferential']).toBe('P');
      expect(row!['COO_Date_of_Issue']).toBe('09-Sep-2025');
      expect(row!['COO_Issuing_Country']).toBe('JP');
      expect(row!['COO_Origin_Criteria']).toBe('CTH');
      expect(row!['COO_Direct_Consignment']).toBe('Y');
      expect(row!['COO_Retroactive_Issuance']).toBe('N');
    });

    it('keeps the 18-digit COO number exact', async () => {
      // 250377141204202410 is past the point where a float64 holds integers
      // exactly; as a number it becomes 250377141204202000.
      const [row] = await readSheet(workbook, 'ITEMS');
      expect(row!['COO_No']).toBe('250377141204202410');
      expect(typeof row!['COO_No']).toBe('string');
    });
  });

  describe('EXCHANGE_RATE', () => {
    it('carries the CBIC rate', async () => {
      const rows = await readSheet(workbook, 'EXCHANGE_RATE');
      // Two rows: Logi-Sys' own export leads with the rupee at parity, so the
      // sheet states the base of the conversion rather than implying it.
      expect(rows).toHaveLength(2);
      expect(rows[0]!['CURRENCY_CODE']).toBe('INR');
      expect(rows[0]!['EXCHANGE_RATE']).toBe('1.000000');
      expect(rows[1]!['CURRENCY_CODE']).toBe('USD');
      expect(rows[1]!['EXCHANGE_RATE']).toBe('96.050000');
    });
  });

  describe('SW_ADDL_INFO', () => {
    it('carries all four Single Window declarations', async () => {
      const rows = await readSheet(workbook, 'SW_ADDL_INFO');
      expect(rows).toHaveLength(4);

      // Both columns are code columns. The draft carries the prose the
      // Logi-Sys UI shows ("Standard UQC"); its own export writes SQC.
      expect(rows.map((r) => r['Info_Type'])).toEqual(['CHR', 'CTG', 'IDT', 'PNM']);

      const uqc = rows.find((r) => r['info_Qualifier'] === 'SQC');
      expect(uqc!['Measure']).toBe('156450.000000');
      expect(uqc!['Measure_Unit']).toBe('KGS');

      const cpc = rows.find((r) => r['info_Qualifier'] === 'CPC');
      expect(cpc!['Info_Code_Description']).toBe('CPCPR');

      const cas = rows.find((r) => r['info_Qualifier'] === 'CAS');
      expect(cas!['Information']).toBe('9003-07-0');

      const iupac = rows.find((r) => r['info_Qualifier'] === 'IUP');
      expect(iupac!['Information']).toBe('POLYPROPYLENE');

      // The rows that carry no measurement get 0.000000, not a blank, as they
      // do on the vendor's export.
      for (const row of [cpc, cas, iupac]) expect(row!['Measure']).toBe('0.000000');
    });

    it('numbers every row against invoice 1, item 1', async () => {
      const rows = await readSheet(workbook, 'SW_ADDL_INFO');
      for (const row of rows) {
        expect(row['Inv_SrNo']).toBe('1');
        expect(row['Item_SrNo']).toBe('1');
      }
    });
  });

  describe('SUPPORTING_DOCS', () => {
    it('lists the documents in a warning rather than on the sheet', async () => {
      // Logi-Sys makes ten columns mandatory here, two of which (Doc_IRN,
      // Doc_Upload_DateTime) eSanchit only issues at upload time. Filling the
      // rest produced 33 rejections on a three-document job.
      const rows = await readSheet(workbook, 'SUPPORTING_DOCS');
      expect(rows).toHaveLength(0);

      const [warning] = warnings.filter((w) => w.startsWith('SUPPORTING_DOCS'));
      expect(warning).toBeDefined();
      for (const file of [
        'COPY BL EP061126-1.pdf',
        'EPA EP061126-1.pdf',
        'INV EP061126-1.pdf',
        'PL EP061126-1.pdf',
      ]) {
        expect(warning, `names ${file}`).toContain(file);
      }
    });
  });

  describe('STATEMENT', () => {
    it('files the standing declarations, scoped as Logi-Sys scopes them', async () => {
      const rows = await readSheet(workbook, 'STATEMENT');
      expect(
        rows.map((r) => [r['Inv_SrNo'], r['Item_SrNo'], r['StatementType'], r['StatementCode']]),
      ).toEqual([
        ['0', '0', 'DEC', 'CUG00'],
        ['0', '0', 'DEC', 'CUG01'],
        ['1', '0', 'DEC', 'CUV01'],
        ['1', '0', 'DEC', 'CUV02'],
        ['1', '0', 'DEC', 'CUV03'],
        // Item-scoped, so one per line. This job has one.
        ['1', '1', 'DEC', 'PC002'],
      ]);
    });
  });

  describe('sheets that do not apply to a home-consumption BE', () => {
    it('leaves them header-only', async () => {
      const wb = await openWorkbook(workbook);
      for (const name of [
        'INBOND_EXBOND',
        'SEC65_EXBOND_INFO',
        'RE-IMPORT',
        'LICENSE',
        'SW_CONSTITUENT',
        'SW_CONTROL',
        'SEZ_INFO',
        'HSS',
        'BONDS_CERTIFICATES',
        'SW_PRODUCTION', // no batch data: polypropylene is not a PGA commodity
        'SUPPORTING_DOCS', // eSanchit issues the mandatory IRN, not us
      ]) {
        expect(wb.getWorksheet(name)!.rowCount, `${name} row count`).toBe(1);
      }
    });
  });

  describe('reporting', () => {
    it('names the columns it could not fill instead of failing silently', async () => {
      // The known gap for this job: the draft was built before there was an
      // organization repository to bind the parties to, so `Importer` and
      // `Supplier_Name` are the names off the shipping documents. Logi-Sys
      // keys its parties on exactly those two strings, so both must say so.
      expect(warnings.some((w) => w.startsWith('GENERAL.Importer'))).toBe(true);
      expect(warnings.some((w) => w.startsWith('INVOICES.Supplier_Name'))).toBe(true);
    });

    it('produces no blockers for a complete draft', async () => {
      // buildLogisysWorkbook throws on a blocker, so reaching beforeAll at all
      // proves this; asserted explicitly so the intent is on the record.
      const result = await buildLogisysWorkbook({
        draft: EP061126_1_DRAFT,
        job: EP061126_1_JOB,
      });
      expect(result.fileName).toBe('logisys-EP061126-1-20260630.xlsx');
      expect(result.templateVersion).toMatch(/^1\.0\.0\+[0-9a-f]{8}$/);
    });
  });
});

describe('refusing to misdeclare', () => {
  it('throws when a line’s quantity and unit price do not reconcile', async () => {
    // The unit-conversion failure: quantity rescaled from MT to KGS, unit
    // price left per-MT. Silently exporting this overstates the consignment
    // by a factor of 1000.
    const broken = structuredClone(EP061126_1_DRAFT);
    broken.items[0]!.unitPrice = 1207.57;

    await expect(
      buildLogisysWorkbook({ draft: broken, job: EP061126_1_JOB }),
    ).rejects.toThrow(/does not match the line amount/);
  });

  it('throws when an item has no usable tariff code', async () => {
    const broken = structuredClone(EP061126_1_DRAFT);
    broken.items[0]!.ritc = '';

    await expect(
      buildLogisysWorkbook({ draft: broken, job: EP061126_1_JOB }),
    ).rejects.toThrow(/no usable tariff code/);
  });

  it('throws when the country of origin cannot be coded', async () => {
    const broken = structuredClone(EP061126_1_DRAFT);
    broken.shipment.countryOfOrigin = 'Nowhereland';

    await expect(
      buildLogisysWorkbook({ draft: broken, job: EP061126_1_JOB }),
    ).rejects.toThrow(/has no ISO country code/);
  });

  it('throws when there is no exchange rate', async () => {
    const broken = structuredClone(EP061126_1_DRAFT);
    broken.invoiceMeta.exchangeRate = { currency: 'USD', rate: 0 };

    await expect(
      buildLogisysWorkbook({ draft: broken, job: EP061126_1_JOB }),
    ).rejects.toThrow(/No exchange rate/);
  });
});
