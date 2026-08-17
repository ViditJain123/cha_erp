import 'server-only';
import type { Tables } from '@checklist/db';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { doAlerts, type DeliveryMode, type DoAlert, type DoStatus } from '@/lib/do';

type Db = ReturnType<typeof serviceClient>;

export interface JobDoSummary {
  jobId: string;
  status: DoStatus;
  alerts: DoAlert[];
}

/**
 * The DO deadlines for a set of jobs, in four queries whatever the job count.
 *
 * Shared by the job header, the job list and the dashboard so all three show
 * the same thing — the alternative is three near-identical queries drifting
 * apart, which is how a job ends up amber on one screen and clear on another.
 *
 * Every query is scoped by company_id: serviceClient() bypasses RLS, so that
 * filter is the only thing keeping a guessed uuid inside its tenant.
 */
export async function loadDoSummaries(
  companyId: string,
  jobIds: string[],
): Promise<Map<string, JobDoSummary>> {
  const summaries = new Map<string, JobDoSummary>();
  if (jobIds.length === 0) return summaries;

  const db = serviceClient();
  const [{ data: dos }, { data: jobs }] = await Promise.all([
    db.from('job_do').select('*').eq('company_id', companyId).in('job_id', jobIds),
    db.from('jobs').select('id, eta').eq('company_id', companyId).in('id', jobIds),
  ]);

  if (!dos || dos.length === 0) return summaries;

  const doIds = dos.map((d) => d.id);
  const [{ data: containers }, { data: invoices }] = await Promise.all([
    db
      .from('job_do_containers')
      .select('job_do_id, container_no, free_days, free_time_from, returned_on, deposit_status')
      .eq('company_id', companyId)
      .in('job_do_id', doIds),
    db
      .from('job_do_invoices')
      .select('job_do_id, kind, scrutinised_at')
      .eq('company_id', companyId)
      .in('job_do_id', doIds),
  ]);

  const etaByJob = new Map((jobs ?? []).map((j) => [j.id, j.eta]));
  const scrutinisedProforma = new Set(
    (invoices ?? [])
      .filter((i) => i.kind === 'proforma' && i.scrutinised_at !== null)
      .map((i) => i.job_do_id),
  );

  for (const record of dos) {
    summaries.set(record.job_id, {
      jobId: record.job_id,
      status: record.status,
      alerts: doAlerts({
        eta: etaByJob.get(record.job_id) ?? null,
        status: record.status,
        freeDays: record.free_days,
        freeTimeFrom: record.free_time_from,
        deliveredAt: record.delivered_at,
        doValidUntil: record.do_valid_until,
        proformaScrutinised: scrutinisedProforma.has(record.id),
        containers: (containers ?? [])
          .filter((c) => c.job_do_id === record.id)
          .map((c) => ({
            containerNo: c.container_no,
            freeDays: c.free_days,
            freeTimeFrom: c.free_time_from,
            returnedOn: c.returned_on,
            depositStatus: c.deposit_status,
          })),
      }),
    });
  }

  return summaries;
}

// ------------------------------------------------------------- matching ----

/** Normalises a name for master matching: case, punctuation and suffixes all vary. */
export function matchKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|FZE|FZCO|GMBH)\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export type SecurityReason = 'unknown' | 'none' | 'expired' | 'not_yet_valid' | 'mode' | 'covered';

export interface ResolvedSecurity {
  security: Tables<'importer_line_securities'> | null;
  covers: boolean;
  reason: SecurityReason;
}

/**
 * Which bond or standing deposit, if any, covers this job.
 *
 * Matched on the importer's name because there is no importer master yet, so
 * the caller has to be able to tell "nothing is recorded for this importer"
 * from "something is, and it does not cover this" — a misspelled name would
 * otherwise look exactly like a genuinely uncovered job. Hence `reason`.
 */
export async function findSecurity(
  companyId: string,
  shippingLineId: string | null,
  importerName: string | null,
  mode: DeliveryMode,
): Promise<ResolvedSecurity> {
  if (!shippingLineId || !importerName) {
    return { security: null, covers: false, reason: 'unknown' };
  }

  const db = serviceClient();
  const { data: securities } = await db
    .from('importer_line_securities')
    .select('*')
    .eq('company_id', companyId)
    .eq('shipping_line_id', shippingLineId)
    .eq('is_active', true);

  const key = matchKey(importerName);
  const match = (securities ?? []).find(
    (s) => matchKey(s.importer_name) === key || s.importer_aliases.some((a) => matchKey(a) === key),
  );
  if (!match) return { security: null, covers: false, reason: 'none' };

  const today = new Date().toISOString().slice(0, 10);
  if (match.valid_to && match.valid_to < today) {
    return { security: match, covers: false, reason: 'expired' };
  }
  if (match.valid_from && match.valid_from > today) {
    return { security: match, covers: false, reason: 'not_yet_valid' };
  }

  const covers =
    mode === 'loaded' ? match.covers_loaded : mode === 'destuffed' ? match.covers_destuffed : false;
  return { security: match, covers, reason: covers ? 'covered' : 'mode' };
}

/** The line's deposit for one container size, falling back to a '*' rate. */
export function rateFor(
  rates: Tables<'shipping_line_deposit_rates'>[],
  mode: NonNullable<DeliveryMode>,
  sizeType: string | null,
): number | null {
  const forMode = rates.filter((r) => r.delivery_mode === mode);
  const size = (sizeType ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const exact = forMode.find(
    (r) => r.container_size.toUpperCase().replace(/[^A-Z0-9]/g, '') === size,
  );
  return exact?.amount ?? forMode.find((r) => r.container_size === '*')?.amount ?? null;
}

// --------------------------------------------------------------- seeding ----

/**
 * Everything the DO seeds itself from, read out of documents already ingested.
 *
 * Nothing here re-reads a PDF: the fields come from the triage digest stored on
 * job_documents.classification at ingest, falling back to the checklist draft
 * for jobs ingested before those fields existed.
 */
interface DoSeed {
  shippingLineName: string | null;
  freeDays: number | null;
  surrendered: boolean | null;
  deliveryMode: DeliveryMode;
  containers: { number: string; sizeType: string | null }[];
}

async function readSeed(db: Db, companyId: string, jobId: string): Promise<DoSeed> {
  const [{ data: documents }, { data: identifiers }, { data: draftRow }] = await Promise.all([
    db
      .from('job_documents')
      .select('doc_type, classification')
      .eq('company_id', companyId)
      .eq('job_id', jobId),
    db.from('job_identifiers').select('value_raw').eq('job_id', jobId).eq('kind', 'container'),
    db
      .from('job_drafts')
      .select('draft')
      .eq('company_id', companyId)
      .eq('job_id', jobId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const bl = (documents ?? []).find((d) => d.doc_type === 'bill_of_lading');
  const digest = (bl?.classification ?? {}) as Record<string, unknown>;

  const draft = (draftRow?.draft ?? {}) as {
    shipment?: {
      shippingLineOrCarrier?: string | null;
      containers?: { number?: string; sizeType?: string | null }[];
    };
  };

  const num = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const str = (value: unknown): string | null =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

  const normalise = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const containerSizes = new Map(
    (draft.shipment?.containers ?? [])
      .filter((c): c is { number: string; sizeType?: string | null } => Boolean(c.number))
      .map((c) => [normalise(c.number), c.sizeType ?? null]),
  );

  const containers = (identifiers ?? []).map((i) => ({
    number: i.value_raw,
    sizeType: containerSizes.get(normalise(i.value_raw)) ?? null,
  }));

  return {
    shippingLineName: str(digest.shippingLine) ?? str(draft.shipment?.shippingLineOrCarrier),
    freeDays: num(digest.detentionFreeDays),
    // Only a positive surrender indication seeds the flag. "An original was
    // issued" is not "it has not been surrendered" — surrender happens after
    // issue, usually by an email the B/L never sees — so anything else stays
    // null, which reads as "nobody has checked".
    surrendered: digest.blSurrenderIndication === 'surrendered' ? true : null,
    // LCL cargo is de-stuffed by definition. FCL is not decided by the B/L —
    // a full container can still be emptied at the CFS — so it stays open.
    deliveryMode: digest.containerMode === 'LCL' ? 'destuffed' : null,
    containers,
  };
}

/**
 * Loads the DO for a job, creating and seeding it on first visit.
 *
 * Created lazily rather than by a backfill migration or a trigger, so every job
 * that already exists picks one up the moment someone opens the tab.
 */
export async function loadOrCreateDo(jobId: string) {
  const ctx = await requireCompany();
  const db = serviceClient();

  const { data: job } = await db
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) throw new Error('No such job.');

  const existing = await db
    .from('job_do')
    .select('*')
    .eq('company_id', ctx.companyId)
    .eq('job_id', jobId)
    .maybeSingle();
  if (existing.data) return { ctx, db, job, record: existing.data };

  const seed = await readSeed(db, ctx.companyId, jobId);

  // Match the carrier printed on the B/L against the master, by name or alias.
  let line: { id: string; default_free_days: number | null } | null = null;
  if (seed.shippingLineName) {
    const { data: lines } = await db
      .from('shipping_lines')
      .select('id, name, aliases, default_free_days')
      .eq('company_id', ctx.companyId)
      .eq('is_active', true);
    const key = matchKey(seed.shippingLineName);
    line =
      (lines ?? []).find(
        (l) => matchKey(l.name) === key || l.aliases.some((a) => matchKey(a) === key),
      ) ?? null;
  }

  const freeDays = seed.freeDays ?? line?.default_free_days ?? null;
  const freeDaysSource =
    seed.freeDays !== null
      ? 'bill_of_lading'
      : line?.default_free_days != null
        ? 'shipping_line'
        : null;

  const { data: created, error } = await db
    .from('job_do')
    .insert({
      company_id: ctx.companyId,
      job_id: jobId,
      bl_surrendered: seed.surrendered,
      free_days: freeDays,
      free_days_source: freeDaysSource,
      free_time_from: job.eta,
      delivery_mode: seed.deliveryMode,
      shipping_line_id: line?.id ?? null,
    })
    .select('*')
    .single();

  // A concurrent first visit loses the unique(job_id) race; read theirs.
  if (error || !created) {
    const { data: raced } = await db
      .from('job_do')
      .select('*')
      .eq('company_id', ctx.companyId)
      .eq('job_id', jobId)
      .maybeSingle();
    if (raced) return { ctx, db, job, record: raced };
    throw new Error(error?.message ?? 'Could not open the delivery order.');
  }

  if (seed.containers.length > 0) {
    await db.from('job_do_containers').insert(
      seed.containers.map((c) => ({
        company_id: ctx.companyId,
        job_do_id: created.id,
        job_id: jobId,
        container_no: c.number,
        size_type: c.sizeType,
      })),
    );
  }

  await db.from('job_events').insert({
    company_id: ctx.companyId,
    job_id: jobId,
    actor_kind: 'user',
    actor_user_id: ctx.userId,
    type: 'do.opened',
    payload: {
      containers: seed.containers.length,
      shippingLine: seed.shippingLineName,
      freeDays,
      freeDaysSource,
    },
  });

  return { ctx, db, job, record: created };
}
