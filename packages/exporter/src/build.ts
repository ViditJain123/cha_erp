import { bondsCertificatesRows } from './map/bonds-certificates.js';
import { containersRows } from './map/containers.js';
import { createCollector, type ExportJob } from './map/context.js';
import { exchangeRateRows } from './map/exchange-rate.js';
import { generalRows } from './map/general.js';
import { hssRows } from './map/hss.js';
import { inbondExbondRows } from './map/inbond-exbond.js';
import { invoicesRows } from './map/invoices.js';
import { itemsRows } from './map/items.js';
import { reImportRows } from './map/re-import.js';
import { sec65ExbondInfoRows } from './map/sec65-exbond-info.js';
import { shipmentRows } from './map/shipment.js';
import { statementRows } from './map/statement.js';
import { supportingDocsRows } from './map/supporting-docs.js';
import { swAddlInfoRows } from './map/sw-addl-info.js';
import { swProductionRows } from './map/sw-production.js';
import { fillTemplate, type SheetRow } from './sheet-writer.js';
import { loadTemplate, templateHash } from './template.js';
import type { LogisysExportInput, LogisysExportResult } from './types.js';

/**
 * Version stamped onto every export, recorded in `job_exports.template_version`.
 *
 * The template's own hash is part of it: an export is only reproducible if you
 * know both which generator produced it and which vendor template it was built
 * against.
 */
export function logisysTemplateVersion(): string {
  return `1.0.0+${templateHash().slice(0, 8)}`;
}

/**
 * Sheets we deliberately leave header-only for a home-consumption Bill of Entry.
 *
 * Listed rather than merely omitted so that "we decided this does not apply"
 * is distinguishable from "we forgot".
 */
/**
 * The sheets a mapper fills. Together with `UNMAPPED_SHEETS` this accounts for
 * all nineteen of the vendor's, and `test/structure.test.ts` asserts that.
 *
 * Declared rather than inferred so the `data` object below cannot quietly gain
 * or lose a sheet: it is typed against this list, so adding a mapper without
 * naming it here — or naming a sheet no mapper fills — is a compile error.
 */
export const MAPPED_SHEETS = [
  'GENERAL',
  'INBOND_EXBOND',
  'SHIPMENT',
  'CONTAINERS',
  'INVOICES',
  'ITEMS',
  'STATEMENT',
  'SEC65_EXBOND_INFO',
  'RE-IMPORT',
  'SW_ADDL_INFO',
  'SW_PRODUCTION',
  // A row per document whose eSanchit IRN and upload timestamp we hold, and a
  // warning naming the ones we do not. See docs/boe-mapping/18-supporting-docs.md.
  'SUPPORTING_DOCS',
  'HSS',
  'BONDS_CERTIFICATES',
  'EXCHANGE_RATE',
] as const;

export const UNMAPPED_SHEETS = [
  'LICENSE', // advance authorisation / EPCG debits
  // The composition of a finished formulation, for a BE referred to the Drug
  // Controller. Empty even then: ex_job17 is an ADC case and filed none, and
  // ICES accepted it. See docs/boe-mapping/12-sw-constituent.md.
  'SW_CONSTITUENT',
  // The plain PGA use of BE_ITEM_SW_CTRL — a pre-arrival inspection. Its two
  // mandatory coded columns have no published directory, and no filing in the
  // corpus carries a control. See docs/boe-mapping/14-sw-control.md.
  'SW_CONTROL',
  // Only on a T- or M-type SEZ Bill of Entry, a DTA sale out of a zone. Nothing
  // in the corpus is one. See docs/boe-mapping/15-sez-info.md.
  'SEZ_INFO',
] as const;

function safeFileNamePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * Builds the Logi-Sys import workbook for a job.
 *
 * Refuses rather than guesses. If a mapper reports a blocker — a missing tariff
 * code, a line whose quantity and price do not reconcile, no exchange rate —
 * this throws instead of producing a workbook that would misstate the
 * consignment to Customs. Warnings are returned for the operator to complete
 * in Logi-Sys.
 */
export async function buildLogisysWorkbook(
  input: LogisysExportInput,
): Promise<LogisysExportResult> {
  const { draft, job } = input;
  const collector = createCollector();
  const ctx = collector.context(draft, job as ExportJob);

  const data: Record<(typeof MAPPED_SHEETS)[number], SheetRow[]> = {
    GENERAL: generalRows(ctx),
    // No rows for a home-consumption BE, which leaves the sheet header-only.
    INBOND_EXBOND: inbondExbondRows(ctx),
    SHIPMENT: shipmentRows(ctx),
    CONTAINERS: containersRows(ctx),
    INVOICES: invoicesRows(ctx),
    ITEMS: itemsRows(ctx),
    STATEMENT: statementRows(ctx),
    // No rows unless this is a section 65 ex-bond BE clearing a resultant
    // product, which leaves the sheet header-only for every other filing.
    SEC65_EXBOND_INFO: sec65ExbondInfoRows(ctx),
    // No rows unless a line of goods is coming back from an export, which
    // leaves the sheet header-only for every ordinary import.
    'RE-IMPORT': reImportRows(ctx),
    SW_ADDL_INFO: swAddlInfoRows(ctx),
    SW_PRODUCTION: swProductionRows(ctx),
    // A row per document that has its eSanchit IRN; the rest warn.
    SUPPORTING_DOCS: supportingDocsRows(ctx),
    // No rows unless the goods were sold afloat, which leaves the sheet
    // header-only for every ordinary import.
    HSS: hssRows(ctx),
    BONDS_CERTIFICATES: bondsCertificatesRows(ctx),
    EXCHANGE_RATE: exchangeRateRows(ctx),
  };

  if (collector.blockers.length) {
    const detail = collector.blockers.map((b) => `${b.path}: ${b.message}`).join('\n');
    throw new Error(
      `This job cannot be exported to Logi-Sys yet:\n${detail}\n\n` +
        'These would produce a Bill of Entry that misstates the consignment, so no file was generated.',
    );
  }

  const template = await loadTemplate();
  const buffer = await fillTemplate(template, data);

  const reference = job.reference ?? job.id;
  // The first invoice dates the file. A BE with a dozen invoices has a dozen
  // dates and only one filename.
  const stamp = safeFileNamePart((draft.invoices[0]?.invoiceDate ?? '').replace(/-/g, ''));

  return {
    buffer,
    fileName: `logisys-${safeFileNamePart(reference)}-${stamp}.xlsx`,
    templateVersion: logisysTemplateVersion(),
    warnings: collector.warnings.map((w) => `${w.path}: ${w.message}`),
  };
}
