import { lookupTariff } from '@checklist/core';
import type { ChecklistDraft } from '../draft.js';
import type { MailInstructions } from '../instructions.js';
import type { ExtractedDoc } from '../schemas.js';
import { hasTextLayer, pageTexts, type AgentFile } from './documents.js';

/**
 * The first turn: everything the job already knows, compactly.
 *
 * The extracts are not sent — a five-document job's `ExtractedDoc[]` is
 * thirty thousand tokens of which the agent needs a few hundred. What goes is
 * the merged draft's view of the consignment, the document table (so the
 * agent can see there is a licence it has not been shown), and the open flags.
 * Anything else it fetches with a tool.
 */
export interface JobContextInput {
  draft: ChecklistDraft;
  docs: ExtractedDoc[];
  files: AgentFile[];
  filingDate: string;
  filingDateSource?: string;
  instructions?: MailInstructions | null;
}

const MAX_FLAGS = 40;
const DESCRIPTION = 200;

function clip(text: string | null | undefined, n: number): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `${label}: ${value}`;
}

function block(lines: (string | null)[]): string {
  return lines.filter((l): l is string => Boolean(l)).join('\n');
}

export async function renderJobContext(input: JobContextInput): Promise<string> {
  const { draft, docs, files, filingDate, instructions } = input;
  const s = draft.shipment;

  // ---- header ----
  const header = block([
    `Filing date: ${filingDate}${input.filingDateSource ? ` (${input.filingDateSource})` : ''}. Use only notifications in force on this date.`,
    line('Bill of Entry type', draft.beType),
    line('Transport', draft.transportMode),
    line('Custom station', draft.customStation ? `${draft.customStation.code} ${draft.customStation.name}` : null),
    line('Importer', draft.importer.name),
    line('Supplier', draft.supplier.name + (draft.supplier.country ? `, ${draft.supplier.country}` : '')),
    line('Country of origin (shipment)', s.countryOfOrigin),
    line('Port of loading', s.portOfLoading),
    line('Port of discharge', s.portOfDischarge),
    line('B/L or AWB', s.mawbNo ?? s.blNo ?? s.hawbNo ?? s.hblNo),
    line('Shipped on', s.blDate ?? s.mawbDate),
  ]);

  // ---- mail ----
  const mail = instructions
    ? block([
        line('End use (mail)', instructions.endUse ? `${instructions.endUse} — "${clip(instructions.endUseQuote, 160)}"` : null),
        line(
          'FTA benefit (mail)',
          instructions.claimFtaBenefit === null || instructions.claimFtaBenefit === undefined
            ? null
            : `${instructions.claimFtaBenefit ? 'claim' : 'do not claim'} — "${clip(instructions.claimFtaBenefitQuote, 160)}"`,
        ),
        line('BE type (mail)', instructions.beType ? `${instructions.beType} — "${clip(instructions.beTypeQuote, 120)}"` : null),
        ...(instructions.otherInstructions ?? []).slice(0, 6).map((o) => `Other instruction (mail): "${clip(o, 200)}"`),
      ])
    : '';

  // ---- documents ----
  const byFile = new Map<string, ExtractedDoc[]>();
  for (const d of docs) byFile.set(d.fileName, [...(byFile.get(d.fileName) ?? []), d]);
  const documents = await Promise.all(
    files.map(async (f) => {
      const texts = await pageTexts(f);
      const types = (byFile.get(f.fileName) ?? []).map((d) => `${d.docType}${d.data ? '' : ' (not extracted)'}`);
      const layer = (f.mimeType ?? 'application/pdf') !== 'application/pdf' ? 'image' : hasTextLayer(texts) ? 'text' : 'scan, no text layer';
      return `- ${f.fileName}: ${types.length ? types.join(' + ') : 'not classified'}${f.hint ? `; ingest says ${f.hint}` : ''}; ${texts.length ? `${texts.length} page(s), ` : ''}${layer}`;
    }),
  );

  // ---- invoices ----
  const invoices = draft.invoices.map(
    (inv) =>
      `- Invoice ${inv.srNo}: ${inv.invoiceNumber} dated ${inv.invoiceDate || '?'}, ${inv.currency} ${inv.invoiceValue}, ${inv.termsOfInvoice}` +
      `${inv.natureOfTransaction && inv.natureOfTransaction !== 'SALE' ? `, ${inv.natureOfTransaction}` : ''}`,
  );

  // ---- certificates of origin ----
  const coos = (draft.certificatesOfOrigin ?? []).map(
    (c) =>
      `- COO ${c.certificateNumber}${c.fileName ? ` (${c.fileName})` : ''}: ${c.schemeText ? `"${clip(c.schemeText, 80)}", ` : ''}origin ${c.originCountry ?? '?'}` +
      `${c.originCriterion ? `, criterion ${c.originCriterion}` : ''}${c.issuedRetroactively ? ', issued retroactively' : ''}` +
      (c.items.length ? `; items: ${c.items.slice(0, 8).map((i) => `${i.hsCode ?? '?'} ${clip(i.description, 60)}`).join(' | ')}` : ''),
  );

  // ---- items ----
  const items = draft.items.map((it, idx) => {
    const row = /^\d{8}$/.test(it.ritc) ? lookupTariff(it.ritc) : undefined;
    const serials = it.notificationSerials ?? {};
    return block([
      `- Item ${it.invoiceSrNo}/${it.slNo} (items.${idx}): "${clip(it.description, DESCRIPTION)}"`,
      line('  general description', it.generalDescription ? clip(it.generalDescription, 120) : null),
      `  qty ${it.quantity} ${it.unit} @ ${it.unitPrice} = ${it.amount}${it.foc ? ' (FOC)' : ''}`,
      line('  origin', it.originCountry ?? null),
      line('  manufacturer', it.manufacturerName ?? null),
      `  CTH ${it.ritc || '(none)'}${it.sources?.ritc ? ` [${it.sources.ritc}]` : ''}${row ? ` "${clip(row.description, 100)}" BCD ${row.bcdRate}% IGST ${row.igstRate}%${row.impPolicy && row.impPolicy !== 'Free' ? ` policy ${row.impPolicy}` : ''}` : ''}`,
      `  current: BCD ${it.bcdRate}%${it.bcdNotification ? ` under ${it.bcdNotification}${serials.basic ? ` S.No. ${serials.basic}` : ''}` : ''}` +
        `${it.bcdExemption ? `; claim ${it.bcdExemption.notification}${it.bcdExemption.serial ? ` ${it.bcdExemption.serial}` : ''}${it.bcdExemption.scheme ? ` (${it.bcdExemption.scheme})` : ''}` : ''}` +
        `; IGST ${it.igstRate}%${serials.igst ? ` ${serials.igst}` : ''}; cess ${it.compCessRate}%${serials.compCess ? ` ${serials.compCess}` : ''}`,
      line('  exim scheme', it.eximScheme ? `${it.eximScheme.code ?? '?'} ${it.eximScheme.notification ?? ''} ${it.eximScheme.serial ?? ''}`.trim() : null),
      line('  FTA', it.fta ? `${it.fta.scheme} ${it.fta.notification}${it.fta.serial ? ` ${it.fta.serial}` : ''}` : null),
      line('  end use', it.endUseCode || null),
      line('  packing', it.packing ? `${it.packing.packages ?? '?'} pkgs, net ${it.packing.netWeightKg ?? '?'} kg` : null),
      line('  re-import', it.reImport ? `SB ${it.reImport.sbNo} ${it.reImport.sbDate}` : null),
    ]);
  });

  // ---- flags ----
  const flags = draft.flags
    .filter((f) => f.path?.startsWith('items.') || f.severity === 'error')
    .slice(0, MAX_FLAGS)
    .map((f) => `- [${f.severity}] ${f.path ?? ''}: ${clip(f.message, 160)}`);

  return [
    '# Consignment',
    header,
    mail ? `\n# Instructions from the customer's mail\n${mail}` : '',
    `\n# Documents on the job (${files.length})`,
    documents.join('\n'),
    `\n# Invoices`,
    invoices.join('\n') || '(none)',
    coos.length ? `\n# Certificates of origin\n${coos.join('\n')}` : '',
    `\n# Lines (${draft.items.length})`,
    items.join('\n') || '(none)',
    flags.length ? `\n# Open flags\n${flags.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
