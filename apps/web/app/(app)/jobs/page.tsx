import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCompany } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { STAGE_LABELS, STAGE_STYLES, relativeTime } from '@/lib/jobs';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const ctx = await requireCompany();
  const db = serviceClient();

  const { data: jobs } = await db
    .from('jobs')
    .select('*')
    .eq('company_id', ctx.companyId)
    .order('updated_at', { ascending: false })
    .limit(200);

  const jobIds = (jobs ?? []).map((j) => j.id);
  const { data: documents } = jobIds.length
    ? await db.from('job_documents').select('job_id, doc_type').in('job_id', jobIds)
    : { data: [] };

  const docCount = new Map<string, number>();
  for (const d of documents ?? []) docCount.set(d.job_id, (docCount.get(d.job_id) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Opened automatically when shipment documents arrive in a connected mailbox.
          </p>
        </div>
      </div>

      {(jobs ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          <div className="font-medium text-slate-700">No jobs yet</div>
          <p className="mx-auto mt-1 max-w-md">
            Connect a mailbox from{' '}
            <Link href="/settings/mailbox" className="text-indigo-600 underline">
              Mailbox settings
            </Link>
            . Emails carrying an invoice, bill of lading or air waybill open a job on their own.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Importer</th>
                <th className="px-4 py-3">Documents</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(jobs ?? []).map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {job.title ?? job.reference ?? 'Untitled job'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{job.importer_name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{docCount.get(job.id) ?? 0}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {job.source === 'email' ? 'Email' : 'Manual'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[job.stage]}`}
                    >
                      {STAGE_LABELS[job.stage]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{relativeTime(job.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
