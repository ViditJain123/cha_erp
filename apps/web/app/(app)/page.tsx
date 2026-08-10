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
  const waiting = open
    .filter((j) => j.stage === 'awaiting_shipper')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  const atNoting = open.filter((j) => j.stage === 'noting');
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

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="With documents" value={withDocuments.length} href="/jobs" />
        <Stat label="In scrutiny" value={inScrutiny.length} href="/jobs" />
        <Stat label="At noting" value={atNoting.length} href="/jobs" />
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

      {atNoting.length > 0 && (
        <section className="rounded-xl border border-emerald-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold">Scrutiny done — at noting</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Handed on. Noting is not tracked in this system yet.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {atNoting.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <Link
                  href={`/jobs/${job.id}`}
                  className="truncate text-sm font-medium text-indigo-600 hover:underline"
                >
                  {job.job_number ?? job.title ?? 'Untitled job'}
                </Link>
                <span className="shrink-0 text-xs text-slate-500">
                  {relativeTime(job.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
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
