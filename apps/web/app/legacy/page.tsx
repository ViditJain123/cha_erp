import Link from 'next/link';
import { listJobs } from '@/lib/store';

export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  processing: 'bg-amber-100 text-amber-800',
  review: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

export default async function JobsPage() {
  const jobs = await listJobs();
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import Jobs</h1>
        <Link href="/legacy/new" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          + New Job
        </Link>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-16 text-center text-slate-500">
          No jobs yet. Drop the shipment documents into a <Link className="text-indigo-600 underline" href="/legacy/new">new job</Link> to
          generate a checklist.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Job No</th>
                <th className="px-4 py-3">Importer</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Duty payable</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/legacy/jobs/${job.id}`} className="text-indigo-600 hover:underline">
                      {job.jobNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{job.draft?.importer.name ?? '—'}</td>
                  <td className="px-4 py-3">{job.draft?.transportMode ?? '—'}</td>
                  <td className="px-4 py-3">{job.draft?.invoice.invoiceNumber ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {job.draft?.duty ? `₹${job.draft.duty.dutyPayable.toLocaleString('en-IN')}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[job.status]}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(job.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
