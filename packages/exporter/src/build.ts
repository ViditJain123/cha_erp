import { containersRows } from './map/containers.js';
import { createCollector, type ExportJob } from './map/context.js';
import { exchangeRateRows } from './map/exchange-rate.js';
import { generalRows } from './map/general.js';
import { invoicesRows } from './map/invoices.js';
import { itemsRows } from './map/items.js';
import { shipmentRows } from './map/shipment.js';
import { supportingDocsRows } from './map/supporting-docs.js';
import { swAddlInfoRows } from './map/sw-addl-info.js';
import { swProductionRows } from './map/sw-production.js';
import { fillTemplate, type SheetData } from './sheet-writer.js';
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
export const UNMAPPED_SHEETS = [
  'INBOND_EXBOND', // warehousing — a different BE type
  'STATEMENT',
  'SEC65_EXBOND_INFO', // in-bond manufacturing
  'RE-IMPORT',
  'LICENSE', // advance authorisation / EPCG debits
  'SW_CONSTITUENT', // chemical constituents, when a PGA asks
  'SW_CONTROL',
  'SEZ_INFO',
  'HSS', // high seas sale
  'BONDS_CERTIFICATES',
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

  const data: SheetData = {
    GENERAL: generalRows(ctx),
    SHIPMENT: shipmentRows(ctx),
    CONTAINERS: containersRows(ctx),
    INVOICES: invoicesRows(ctx),
    ITEMS: itemsRows(ctx),
    SW_ADDL_INFO: swAddlInfoRows(ctx),
    SW_PRODUCTION: swProductionRows(ctx),
    SUPPORTING_DOCS: supportingDocsRows(ctx),
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
  const stamp = draft.invoice.invoiceDate.replace(/-/g, '');

  return {
    buffer,
    fileName: `logisys-${safeFileNamePart(reference)}-${stamp}.xlsx`,
    templateVersion: logisysTemplateVersion(),
    warnings: collector.warnings.map((w) => `${w.path}: ${w.message}`),
  };
}
