import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCompany } from '@/lib/auth';
import { serviceClient, serviceForCompany } from '@/lib/supabase/admin';
import {
  DOCUMENTS_STAGES,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_STYLES,
  relativeTime,
  type JobStage,
} from '@/lib/jobs';
import { DEPOSIT_REFUND_DAYS, formatDay, type DoAlert } from '@/lib/do';
import { loadDoSummaries, type JobDoSummary } from '@/lib/do-read';
import type { ClearanceAlert } from '@/lib/clearance';
import { loadClearanceSummaries, type JobClearanceSummary } from '@/lib/clearance-read';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const ctx = await requireCompany();
  const db = serviceClient();

  const [{ data: company }, { data: jobs }, { data: requests }] = await Promise.all([
    serviceForCompany(ctx.companyId).company(),
    db
      .from('jobs')
      .select('id, title, job_number, stage, updated_at, importer_name')
      .eq('company_id', ctx.companyId)
      .order('updated_at', { ascending: false })
      .limit(500),
    db
      .from('job_document_requests')
      .select('job_id')
      .eq('company_id', ctx.companyId)
      .eq('status', 'pending'),
  ]);

  const all = jobs ?? [];
  const open = all.filter((j) => j.stage !== 'closed');
  const counts = new Map<JobStage, number>();
  for (const job of open) counts.set(job.stage, (counts.get(job.stage) ?? 0) + 1);

  const outstandingByJob = new Set((requests ?? []).map((r) => r.job_id));

  // The DO track runs beside scrutiny, so its deadlines are counted over every
  // open job rather than over a stage.
  const doSummaries = await loadDoSummaries(
    ctx.companyId,
    open.map((j) => j.id),
  );
  const titleFor = new Map(open.map((j) => [j.id, j.job_number ?? j.title ?? 'Untitled job']));
  const importerFor = new Map(open.map((j) => [j.id, j.importer_name]));

  const doOpen = [...doSummaries.values()].filter((s) => s.status !== 'closed');
  const freeTimeDue = alertRows(doSummaries, 'free_time');
  const depositsDue = alertRows(doSummaries, 'deposit_refund');

  const clearanceSummaries = await loadClearanceSummaries(
    ctx.companyId,
    open.map((j) => j.id),
  );
  const inClearance = [...clearanceSummaries.values()].filter((s) => s.status !== 'delivered');
  const dutyVariances = clearanceRows(clearanceSummaries, 'duty_variance');
  const awaitingCfs = clearanceRows(clearanceSummaries, 'awaiting_cfs');
  const openQueries = clearanceRows(clearanceSummaries, 'query_open');
  const waiting = open
    .filter((j) => j.stage === 'awaiting_shipper')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const withDocuments = open.filter((j) => DOCUMENTS_STAGES.includes(j.stage));
  const inScrutiny = open.filter(
    (j) => !DOCUMENTS_STAGES.includes(j.stage) && j.stage !== 'noting',
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{company?.name ?? 'Dashboard'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {open.length === 0
            ? 'No open jobs. They appear here as documents arrive in a connected mailbox.'
            : `${open.length} open job${open.length === 1 ? '' : 's'}.`}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="With documents" value={withDocuments.length} href="/jobs" />
        <Stat label="In scrutiny" value={inScrutiny.length} href="/jobs" />
        <Stat label="In clearance" value={inClearance.length} href="/jobs" />
        <Stat label="DOs open" value={doOpen.length} href="/jobs" />
        <Stat label="Deposits to recover" value={depositsDue.length} href="/jobs" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">By stage</h2>
        {open.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing in progress.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {STAGE_ORDER.filter((stage) => stage !== 'closed').map((stage) => (
              <li key={stage} className="flex items-center justify-between gap-4 px-5 py-2.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[stage]}`}
                >
                  {STAGE_LABELS[stage]}
                </span>
                <span className="text-sm tabular-nums text-slate-600">
                  {counts.get(stage) ?? 0}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {freeTimeDue.length > 0 && (
        <AlertSection
          title="Free time running out"
          subtitle="Detention starts the day after. A container still in the port past this is costing money."
          rows={freeTimeDue}
          titleFor={titleFor}
          importerFor={importerFor}
        />
      )}

      {depositsDue.length > 0 && (
        <AlertSection
          title="Deposits to recover"
          subtitle={`The shipping line's security has to be back within ${DEPOSIT_REFUND_DAYS} days of delivery.`}
          rows={depositsDue}
          titleFor={titleFor}
          importerFor={importerFor}
        />
      )}

      {waiting.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold">
            Waiting on the shipper
          </h2>
          <ul className="divide-y divide-slate-100">
            {waiting.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="block truncate text-sm font-medium text-indigo-600 hover:underline"
                  >
                    {job.job_number ?? job.title ?? 'Untitled job'}
                  </Link>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {job.importer_name ?? '—'}
                    {outstandingByJob.has(job.id) ? ' · documents outstanding' : ' · nothing outstanding'}
                  </div>
                </div>
                {/* Age is the useful number here: a request nobody chased is the
                    thing that quietly stalls a job. */}
                <span className="shrink-0 text-xs text-slate-500">
                  asked {relativeTime(job.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dutyVariances.length > 0 && (
        <ClearanceSection
          title="Duty does not agree with the checklist"
          subtitle="Customs assessed a different figure. These are back with scrutiny and nothing should be paid until they are settled."
          rows={dutyVariances}
          titleFor={titleFor}
          importerFor={importerFor}
        />
      )}

      {awaitingCfs.length > 0 && (
        <ClearanceSection
          title="Awaiting the CFS"
          subtitle="Delivery days put forward and not yet answered."
          rows={awaitingCfs}
          titleFor={titleFor}
          importerFor={importerFor}
        />
      )}

      {openQueries.length > 0 && (
        <ClearanceSection
          title="Customs queries unanswered"
          subtitle="Nothing passes while a query is open."
          rows={openQueries}
          titleFor={titleFor}
          importerFor={importerFor}
        />
      )}
    </div>
  );
}

interface AlertRow {
  jobId: string;
  alert: DoAlert;
}

interface ClearanceRow {
  jobId: string;
  alert: ClearanceAlert;
}

/** Every clearance alert of one kind across the open jobs, worst first. */
function clearanceRows(
  summaries: Map<string, JobClearanceSummary>,
  kind: ClearanceAlert['kind'],
): ClearanceRow[] {
  return [...summaries.values()]
    .flatMap((summary) =>
      summary.alerts
        .filter((a) => a.kind === kind)
        .map((alert) => ({ jobId: summary.jobId, alert })),
    )
    .sort((a, b) => a.alert.daysLeft - b.alert.daysLeft);
}

/**
 * The same shape as AlertSection, for the clearance alerts.
 *
 * Kept separate rather than made generic because the two link to different
 * tabs — a free-time warning belongs on the delivery order, a duty variance on
 * clearance — and threading that through one component earned nothing.
 */
function ClearanceSection({
  title,
  subtitle,
  rows,
  titleFor,
  importerFor,
}: {
  title: string;
  subtitle: string;
  rows: ClearanceRow[];
  titleFor: Map<string, string>;
  importerFor: Map<string, string | null>;
}) {
  const worst = rows.some((r) => r.alert.level === 'overdue');
  return (
    <section
      className={`rounded-xl border bg-white shadow-sm ${worst ? 'border-red-200' : 'border-amber-200'}`}
    >
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row, index) => (
          <li
            key={`${row.jobId}-${index}`}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              <Link
                href={`/jobs/${row.jobId}/clearance`}
                className="block truncate text-sm font-medium text-indigo-600 hover:underline"
              >
                {titleFor.get(row.jobId) ?? 'Untitled job'}
              </Link>
              <div className="mt-0.5 text-xs text-slate-500">
                {importerFor.get(row.jobId) ?? '—'} · {row.alert.label}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                row.alert.level === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {row.alert.dueOn ? formatDay(row.alert.dueOn) : 'now'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Every alert of one kind across the open jobs, soonest — and most overdue — first. */
function alertRows(summaries: Map<string, JobDoSummary>, kind: DoAlert['kind']): AlertRow[] {
  return [...summaries.values()]
    .flatMap((summary) =>
      summary.alerts.filter((a) => a.kind === kind).map((alert) => ({ jobId: summary.jobId, alert })),
    )
    .sort((a, b) => a.alert.daysLeft - b.alert.daysLeft);
}

function AlertSection({
  title,
  subtitle,
  rows,
  titleFor,
  importerFor,
}: {
  title: string;
  subtitle: string;
  rows: AlertRow[];
  titleFor: Map<string, string>;
  importerFor: Map<string, string | null>;
}) {
  const worst = rows.some((r) => r.alert.level === 'overdue');
  return (
    <section
      className={`rounded-xl border bg-white shadow-sm ${worst ? 'border-red-200' : 'border-amber-200'}`}
    >
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((row, index) => (
          <li
            key={`${row.jobId}-${row.alert.containerNo ?? index}`}
            className="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div className="min-w-0">
              <Link
                href={`/jobs/${row.jobId}/do`}
                className="block truncate text-sm font-medium text-indigo-600 hover:underline"
              >
                {titleFor.get(row.jobId) ?? 'Untitled job'}
              </Link>
              <div className="mt-0.5 text-xs text-slate-500">
                {importerFor.get(row.jobId) ?? '—'} · {row.alert.label}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                row.alert.level === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {row.alert.daysLeft < 0
                ? `${Math.abs(row.alert.daysLeft)} d over`
                : row.alert.daysLeft === 0
                  ? 'today'
                  : `${row.alert.daysLeft} d`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Link>
  );
}
