import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { STAGE_LABELS, STAGE_STYLES, relativeTime } from '@/lib/jobs';
import { formatDay, worstLevel } from '@/lib/do';
import { loadDoSummaries } from '@/lib/do-read';
import { loadClearanceSummaries } from '@/lib/clearance-read';
import { JobTabs } from './job-tabs';

export const dynamic = 'force-dynamic';

/**
 * The job header and its tabs. Scrutiny and the delivery order run in parallel,
 * so they are siblings under this layout rather than sections of one page.
 */
export default async function JobLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireCompany();
  const { id } = await params;
  const db = serviceClient();

  // Scoped by company_id as well as id: the service role bypasses RLS, so this
  // is the only thing stopping a guessed uuid from crossing tenants.
  const { data: job } = await db
    .from('jobs')
    .select('id, title, reference, stage, source, created_at, importer_name, job_number, branch_id, eta')
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!job) notFound();

  const [{ data: branch }, doSummaries, clearanceSummaries] = await Promise.all([
    job.branch_id
      ? db.from('branches').select('name').eq('id', job.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    loadDoSummaries(ctx.companyId, [job.id]),
    loadClearanceSummaries(ctx.companyId, [job.id]),
  ]);

  const doAlertLevel = worstLevel(doSummaries.get(job.id)?.alerts ?? []);
  const clearanceAlertLevel = worstLevel(clearanceSummaries.get(job.id)?.alerts ?? []);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-indigo-600 hover:underline">
          ← Jobs
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{job.title ?? job.reference ?? 'Untitled job'}</h1>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[job.stage]}`}
          >
            {STAGE_LABELS[job.stage]}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {job.source === 'email' ? 'Opened from an email' : 'Created manually'} ·{' '}
          {relativeTime(job.created_at)}
          {job.importer_name && ` · ${job.importer_name}`}
        </p>

        {job.job_number && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm shadow-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Job number</dt>
              <dd className="mt-0.5 font-medium">{job.job_number}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Branch</dt>
              <dd className="mt-0.5">{branch?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">ETA</dt>
              <dd className="mt-0.5">{formatDay(job.eta)}</dd>
            </div>
          </dl>
        )}

        <JobTabs
          jobId={job.id}
          doAlertLevel={doAlertLevel}
          clearanceAlertLevel={clearanceAlertLevel}
        />
      </div>

      {children}
    </div>
  );
}
