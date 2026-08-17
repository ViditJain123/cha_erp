import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listCfs } from '../actions';
import { CfsForm } from './cfs-form';
import { CfsRow } from './cfs-row';

export const metadata: Metadata = { title: 'CFS' };
export const dynamic = 'force-dynamic';

export default async function CfsPage() {
  const { ctx, stations, staffCount } = await listCfs();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Container freight stations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Where cargo is de-stuffed and delivered from. A job moved to delivery planning goes to
          the people assigned to its CFS, who say whether the day works.
        </p>
      </div>

      {canManage && <CfsForm />}

      {stations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No stations yet. Delivery planning needs one before it can ask anybody.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">CFS</th>
                <th className="px-4 py-3">Customs station</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">People</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stations.map((station) => (
                <CfsRow
                  key={station.id}
                  cfsId={station.id}
                  name={station.name}
                  code={station.code}
                  port={station.port}
                  contactEmail={station.contact_email}
                  staffCount={staffCount.get(station.id) ?? 0}
                  isActive={station.is_active}
                  canManage={canManage}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
