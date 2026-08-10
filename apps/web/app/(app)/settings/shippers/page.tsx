import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listShippers } from '../actions';
import { ShipperForm } from './shipper-form';
import { ShipperRow } from './shipper-row';

export const metadata: Metadata = { title: 'Shippers' };
export const dynamic = 'force-dynamic';

export default async function ShippersPage() {
  const { ctx, shippers } = await listShippers();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Shippers</h1>
        <p className="mt-1 text-sm text-slate-500">
          Where document requests are sent. Matched against the supplier name on a job, so add the
          other spellings they appear under on invoices.
        </p>
      </div>

      {canManage && <ShipperForm />}

      {shippers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No shippers yet. You can still type an address by hand when sending a request.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Shipper</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Also known as</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shippers.map((shipper) => (
                <ShipperRow
                  key={shipper.id}
                  shipperId={shipper.id}
                  name={shipper.name}
                  email={shipper.email}
                  aliases={shipper.aliases}
                  isActive={shipper.is_active}
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
