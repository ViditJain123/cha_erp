import 'server-only';
import { productDescriptionKey, eximSchemeCode } from '@checklist/core';
import {
  resolveItems,
  retargetItemCth,
  type ChecklistDraft,
  type DraftItem,
  type ItemDecidableField,
  type ItemReImport,
} from '@checklist/extraction';
import type { Database, Json } from '@checklist/db';
import type { ItemRowView } from '@/app/(app)/jobs/[id]/items-panel';
import { serviceClient } from '@/lib/supabase/admin';
import { recomputeDuty } from './recompute';

/**
 * Resolving the ITEMS sheet — docs/boe-mapping/06-items.md.
 *
 * The merge reads the documents; this applies everything that is not a
 * document, in the contract's order of precedence:
 *
 *   1. `product_master` — what a person confirmed about this importer's product
 *      the last time it came in: CTH, general description, brand, model, end
 *      use, Exim scheme, and the notification choices the masters could not
 *      make alone.
 *   2. `job_mail_instructions` — the importer's end use for this consignment,
 *      and whether to take a preferential rate.
 *   3. `resolveItems` — the duty masters, for the CTH as it now stands.
 *   4. `job_items` — the operator's own edits to this job's lines. Applied
 *      before the masters so a corrected CTH is the one they key off, and again
 *      after so no master-derived value can overwrite a person's decision.
 *
 * Runs on every draft rebuild and whenever an item is saved, so a re-read of
 * the documents never loses a decision.
 */

type ProductMasterRow = Database['public']['Tables']['product_master']['Row'];
type JobItemRow = Database['public']['Tables']['job_items']['Row'];

/** The notification choices a product master row can carry. */
export interface ProductMasterNotifications {
  basic?: { notification: string; serial?: string };
  compCess?: { serial: string };
  igst?: { serial: string };
}

/** Fields of a DraftItem the operator may change from the items panel. */
export const OPERATOR_ITEM_FIELDS = [
  'ritc',
  'generalDescription',
  'brand',
  'model',
  'endUseCode',
  'originCountry',
  'sourceCountry',
  'transitCountry',
  'manufacturerName',
  'manufacturerAddress',
  'manufacturerCountry',
  'manufacturerState',
  'manufacturerPin',
  'accessoryStatus',
  'accessoriesDetails',
  'eximScheme',
  'fta',
  'tradeRemedies',
  'foc',
  'previousBe',
  'materialCode',
  'igstExemption',
  'compCessExemption',
] as const satisfies readonly (keyof DraftItem)[];

export type OperatorItemField = (typeof OPERATOR_ITEM_FIELDS)[number];
export type OperatorItemFields = Partial<Pick<DraftItem, OperatorItemField>>;

/** The provenance key a changed DraftItem field is recorded under. */
function sourceKeyFor(field: OperatorItemField): ItemDecidableField | undefined {
  switch (field) {
    case 'ritc':
    case 'generalDescription':
    case 'brand':
    case 'model':
    case 'endUseCode':
    case 'originCountry':
    case 'fta':
    case 'eximScheme':
    case 'tradeRemedies':
    case 'foc':
      return field;
    case 'manufacturerName':
    case 'manufacturerAddress':
    case 'manufacturerCountry':
    case 'manufacturerState':
    case 'manufacturerPin':
      return 'manufacturer';
    default:
      return undefined;
  }
}

const itemKey = (invoiceSrNo: number, itemSrNo: number) => `${invoiceSrNo}/${itemSrNo}`;

export async function productMasterFor(companyId: string, importerOrgId: string): Promise<Map<string, ProductMasterRow>> {
  const db = serviceClient();
  const { data } = await db
    .from('product_master')
    .select('*')
    .eq('company_id', companyId)
    .eq('importer_org_id', importerOrgId);
  return new Map((data ?? []).map((r) => [r.description_key, r]));
}

export async function operatorItems(companyId: string, jobId: string): Promise<Map<string, JobItemRow>> {
  const db = serviceClient();
  const { data } = await db.from('job_items').select('*').eq('company_id', companyId).eq('job_id', jobId);
  return new Map((data ?? []).map((r) => [itemKey(r.invoice_sr_no, r.item_sr_no), r]));
}

/** A money field for the panel: blank rather than 0 when nothing is known. */
function amountField(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** Apply a product master row to an item. Pure. */
export function applyProductMaster(item: DraftItem, row: ProductMasterRow): DraftItem {
  let out = row.cth !== item.ritc ? retargetItemCth(item, row.cth) : { ...item };
  const sources = { ...out.sources, ritc: 'master' as const };
  if (row.general_description) {
    out.generalDescription = row.general_description;
    sources.generalDescription = 'master';
  }
  if (row.brand) {
    out.brand = row.brand;
    sources.brand = 'master';
  }
  if (row.model) out.model = row.model;
  if (row.end_use_code) {
    out.endUseCode = row.end_use_code;
    sources.endUseCode = 'master';
  }
  const scheme = eximSchemeCode(row.exim_scheme_code);
  if (scheme) {
    out.eximScheme = { ...out.eximScheme, code: scheme };
    sources.eximScheme = 'master';
  }
  const notes = (row.notifications ?? {}) as ProductMasterNotifications;
  if (notes.basic?.notification) {
    out.bcdNotification = notes.basic.notification;
    out.notificationSerials = {
      ...out.notificationSerials,
      ...(notes.basic.serial && { basic: notes.basic.serial }),
    };
  }
  if (notes.igst?.serial) out.notificationSerials = { ...out.notificationSerials, igst: notes.igst.serial };
  if (notes.compCess?.serial) out.notificationSerials = { ...out.notificationSerials, compCess: notes.compCess.serial };
  out = { ...out, sources };
  return out;
}

/** Apply the operator's saved edits to an item. Pure. */
export function applyOperatorItem(
  item: DraftItem,
  row: Pick<JobItemRow, 'fields' | 'classification_confirmed' | 're_import' | 're_import_confirmed'>,
): DraftItem {
  const fields = (row.fields ?? {}) as OperatorItemFields;
  let out: DraftItem = fields.ritc && fields.ritc !== item.ritc ? retargetItemCth(item, fields.ritc) : { ...item };
  const sources = { ...out.sources };
  for (const field of OPERATOR_ITEM_FIELDS) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === undefined || value === null) {
      delete (out as unknown as Record<string, unknown>)[field];
    } else {
      (out as unknown as Record<string, unknown>)[field] = value;
    }
    const key = sourceKeyFor(field);
    if (key) sources[key] = 'operator';
  }
  if (row.classification_confirmed) sources.ritc = 'operator';

  // ---- re-import ----
  // The shipping bill's own facts come from the documents on every rebuild;
  // what the operator stored overrides them, and the confirmation is what turns
  // a proposed notification entry into a claimed one. Without that last step
  // the exporter refuses, which is the whole point: an unconfirmed entry is a
  // duty claim nobody made.
  const savedReImport = (row.re_import ?? undefined) as Partial<ItemReImport> | undefined;
  if (savedReImport && out.reImport) {
    out.reImport = { ...out.reImport, ...savedReImport };
  } else if (savedReImport?.sbNo && savedReImport.sbDate) {
    // A re-import keyed by hand, with no shipping bill on the job to merge on.
    out.reImport = savedReImport as ItemReImport;
  }
  if (out.reImport?.notification && row.re_import_confirmed) {
    out.reImport = {
      ...out.reImport,
      notification: { ...out.reImport.notification, source: 'operator' },
    };
  }
  // A preferential claim the operator entered also has to reach the duty
  // engine and STATEMENT's CUF02 through bcdExemption.
  if ('fta' in fields) {
    if (fields.fta) {
      out.bcdExemption = {
        notification: fields.fta.notification,
        ...(fields.fta.serial && { serial: fields.fta.serial }),
        percent: out.bcdExemption?.percent ?? 100,
        scheme: fields.fta.scheme,
      };
    } else if (out.bcdExemption?.scheme) {
      delete out.bcdExemption;
    }
  }
  out = { ...out, sources };
  return out;
}

/**
 * The whole ITEMS resolution for a job's draft. See the module comment for the
 * order and why it is that order.
 */
export async function applyItemResolution(
  draft: ChecklistDraft,
  companyId: string,
  jobId: string,
): Promise<ChecklistDraft> {
  const db = serviceClient();
  const importerOrgId = draft.importer.organizationId;

  const [master, operator, instructions, org] = await Promise.all([
    importerOrgId ? productMasterFor(companyId, importerOrgId) : Promise.resolve(new Map<string, ProductMasterRow>()),
    operatorItems(companyId, jobId),
    db
      .from('job_mail_instructions')
      .select('end_use, claim_fta_benefit')
      .eq('job_id', jobId)
      .eq('company_id', companyId)
      .maybeSingle()
      .then((r) => r.data),
    importerOrgId
      ? db
          .from('organizations')
          .select('default_end_use_code')
          .eq('id', importerOrgId)
          .eq('company_id', companyId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const before = draft.items.map((item) => {
    let out = item;
    const pm = master.get(productDescriptionKey(item.description));
    if (pm) out = applyProductMaster(out, pm);
    const op = operator.get(itemKey(item.invoiceSrNo, item.slNo));
    if (op) out = applyOperatorItem(out, op);
    return out;
  });

  const resolved = resolveItems(
    { ...draft, items: before },
    {
      today: new Date().toISOString().slice(0, 10),
      mailEndUse: instructions?.end_use ?? null,
      claimFtaBenefit: instructions?.claim_fta_benefit ?? null,
      defaultEndUseCode: org?.default_end_use_code ?? null,
    },
  );

  const after = resolved.items.map((item) => {
    const op = operator.get(itemKey(item.invoiceSrNo, item.slNo));
    return op ? applyOperatorItem(item, { ...op, fields: withoutRitc(op.fields) }) : item;
  });

  return recomputeDuty({ ...resolved, items: after });
}

function withoutRitc(fields: Json): Json {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return fields;
  const { ritc: _ritc, ...rest } = fields as Record<string, Json>;
  return rest;
}

/**
 * Remember a confirmed item in the importer's product master. Called when the
 * operator confirms a line; the next job with the same description uses it
 * without asking.
 */
export async function rememberProduct(input: {
  companyId: string;
  importerOrgId: string;
  jobId: string;
  userId: string;
  item: DraftItem;
}): Promise<{ error?: string }> {
  const { item } = input;
  const db = serviceClient();
  const notifications: ProductMasterNotifications = {
    ...(item.bcdNotification && {
      basic: {
        notification: item.bcdNotification,
        ...(item.notificationSerials?.basic && { serial: item.notificationSerials.basic }),
      },
    }),
    ...(item.notificationSerials?.igst && { igst: { serial: item.notificationSerials.igst } }),
    ...(item.notificationSerials?.compCess && { compCess: { serial: item.notificationSerials.compCess } }),
  };
  const { error } = await db.from('product_master').upsert(
    {
      company_id: input.companyId,
      importer_org_id: input.importerOrgId,
      description_key: productDescriptionKey(item.description),
      description: item.description,
      cth: item.ritc,
      general_description: item.generalDescription ?? null,
      brand: item.brand ?? null,
      model: item.model ?? null,
      end_use_code: item.endUseCode || null,
      exim_scheme_code: item.eximScheme?.code ?? null,
      notifications: notifications as unknown as Json,
      confirmed_by: input.userId,
      confirmed_at: new Date().toISOString(),
      source_job_id: input.jobId,
    },
    { onConflict: 'importer_org_id,description_key' },
  );
  return error ? { error: error.message } : {};
}

/**
 * The question to the importer when a preferential rate is available and no
 * certificate of origin came with the documents. Plain text, for the operator
 * to read and send from the job.
 */
export function ftaBenefitQuestion(draft: ChecklistDraft, jobReference: string | null): { subject: string; body: string } | null {
  const opportunities = draft.ftaOpportunities ?? [];
  if (!opportunities.length) return null;
  const agreements = [...new Set(opportunities.map((o) => o.agreementName))];
  const total = opportunities.reduce((a, o) => a + (o.estimatedSaving ?? 0), 0);
  const lines = opportunities.map((o) => {
    const item = draft.items.find((i) => i.invoiceSrNo === o.invoiceSrNo && i.slNo === o.itemSlNo);
    return (
      `- ${item?.description ?? `Item ${o.invoiceSrNo}/${o.itemSlNo}`} (CTH ${item?.ritc ?? ''}): ` +
      `${o.agreementName}, notification ${o.notification} S.No. ${o.serial}` +
      `${o.preferentialRateText ? ` — ${o.preferentialRateText}` : ''} against the standard ${o.standardBcdRate}% BCD` +
      `${o.estimatedSaving ? `, about Rs. ${o.estimatedSaving.toLocaleString('en-IN')}` : ''}`
    );
  });
  const ref = jobReference ? ` — ${jobReference}` : '';
  return {
    subject: `Preferential duty available under ${agreements.join(' / ')}${ref}`,
    body: [
      'Dear Sir/Madam,',
      '',
      `The goods on this consignment originate in a country that has a trade agreement with India, and a lower rate of basic customs duty is available on them:`,
      '',
      ...lines,
      '',
      total > 0 ? `In all, roughly Rs. ${total.toLocaleString('en-IN')} of duty.` : '',
      'We have not received a certificate of origin with the documents, and the concession cannot be claimed without one.',
      'Please let us know whether you would like to take the benefit. If so, kindly arrange the certificate of origin from the supplier; otherwise we will file at the standard rate.',
      '',
      'Regards,',
    ]
      .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
      .join('\n'),
  };
}

/* ------------------------------------------------------------------ *
 * The items panel's view of the draft
 * ------------------------------------------------------------------ */


/** One draft item as the items panel shows it. Pure. */
export function itemRowView(draft: ChecklistDraft, index: number): ItemRowView {
  const item = draft.items[index]!;
  const notnLine = (n?: string, serial?: string) => (n ? `${n}${serial ? ` S.No. ${serial}` : ''}` : '—');
  const serials = item.notificationSerials ?? {};
  const duties: ItemRowView['duties'] = [
    { label: 'BCD', value: `${item.bcdRate}%${item.bcdExemption ? ` less ${item.bcdExemption.percent}%` : ''} · ${notnLine(item.bcdExemption?.notification ?? item.bcdNotification, item.bcdExemption?.serial ?? serials.basic)}` },
    { label: 'AIDC', value: notnLine(item.aidcLevy?.notification ?? item.aidcNotification, item.aidcLevy?.serial ?? serials.aidc) },
    { label: 'SWS', value: `${item.swsRate}%${item.swsExemption ? ` · ${notnLine(item.swsExemption.notification, item.swsExemption.serial)}` : ''}` },
    { label: 'IGST', value: `${item.igstRate}% · ${notnLine(item.igstNotification, serials.igst)}` },
    { label: 'Comp. cess', value: `${item.compCessRate}% · ${notnLine(item.compCessNotification, serials.compCess)}` },
    ...(item.healthCess ? [{ label: 'Health cess', value: notnLine(item.healthCess.notification, item.healthCess.serial) }] : []),
    ...(item.tariffValue
      ? [{ label: 'Tariff value', value: `${item.tariffValue.currency} ${item.tariffValue.amountPerUnit} per ${item.tariffValue.unit} × ${item.tariffValue.quantity}` }]
      : []),
  ];
  const flags = draft.flags
    .filter((f) => f.path?.startsWith(`items.${index}.`))
    .map((f) => ({ severity: f.severity, message: f.message }));
  return {
    invoiceSrNo: item.invoiceSrNo,
    slNo: item.slNo,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    ritc: item.ritc,
    generalDescription: item.generalDescription ?? '',
    brand: item.brand ?? '',
    model: item.model ?? '',
    endUseCode: item.endUseCode ?? '',
    originCountry: item.originCountry ?? '',
    manufacturerName: item.manufacturerName ?? '',
    manufacturerAddress: item.manufacturerAddress ?? '',
    eximCode: item.eximScheme?.code ?? '',
    accessoryStatus: item.accessoryStatus ?? '0',
    accessoriesDetails: item.accessoriesDetails ?? '',
    foc: Boolean(item.foc),
    previousBe: {
      beNo: item.previousBe?.beNo ?? '',
      beDate: item.previousBe?.beDate ?? '',
      customHouse: item.previousBe?.customHouse ?? '',
      currency: item.previousBe?.currency ?? '',
      unitPrice: item.previousBe?.unitPrice !== undefined ? String(item.previousBe.unitPrice) : '',
    },
    sources: { ...item.sources },
    duties,
    ...(item.reImport && {
      reImport: {
        sbNo: item.reImport.sbNo.value,
        sbDate: item.reImport.sbDate.value,
        portOfExport: item.reImport.portOfExport.value,
        sbInvSrNo: String(item.reImport.sbInvSrNo.value),
        sbItemSrNo: String(item.reImport.sbItemSrNo.value),
        // What is claimed, once someone has said. Empty is the state the
        // exporter refuses on, and the panel says so rather than preselecting.
        chosen: item.reImport.notification
          ? `${item.reImport.notification.value.notification} ${item.reImport.notification.value.serial}`
          : '',
        confirmed: item.reImport.notification?.source === 'operator',
        candidates: (item.reImport.candidates ?? []).map((c) => ({
          key: `${c.notification} ${c.serial}`,
          notification: c.notification,
          serial: c.serial,
          description: c.description,
          amountPayable: c.amountPayable,
          because: c.because,
          cautions: c.cautions,
          needsExportFreightInsurance: c.needsExportFreightInsurance,
          needsIncentiveRepayment: c.needsIncentiveRepayment,
        })),
        exportFreightInr: amountField(item.reImport.exportFreightInr?.value),
        exportInsuranceInr: amountField(item.reImport.exportInsuranceInr?.value),
        customsDuty: amountField(item.reImport.customsDuty?.value),
        exciseDuty: amountField(item.reImport.exciseDuty?.value),
        igstPaid: amountField(item.reImport.igstPaid?.value),
        exclusion: item.reImport.exclusion ?? '',
      },
    }),
    ...(item.fta && {
      fta: {
        scheme: item.fta.scheme,
        notification: item.fta.notification,
        serial: item.fta.serial ?? '',
        cooNumber: item.fta.cooNumber ?? '',
        retroactive: item.fta.retroactiveIssuance ? 'Y' : 'N',
        compliant: item.fta.retroactiveCheck?.compliant ?? true,
      },
    }),
    tradeRemedyCandidates: (item.tradeRemedyCandidates ?? []).map((c) => ({
      label: `${c.kind} ${c.notification} row ${c.cthSerial ?? '?'} — ${c.producer} / ${c.exporter}`,
    })),
    tradeRemedies: (item.tradeRemedies ?? []).map((l) => `${l.kind} ${l.notification}${l.cthSerial ? ` row ${l.cthSerial}` : ''}`),
    flags,
  };
}
