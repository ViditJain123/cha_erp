import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listBondedWarehouses } from '../actions';
import { WarehouseForm } from './warehouse-form';

export const metadata: Metadata = { title: 'Bonded warehouses' };
export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  public: 'Public (s.57)',
  private: 'Private (s.58)',
  special: 'Special (s.58A)',
};

const SOURCE_LABEL: Record<string, string> = {
  icegate: 'ICEGATE',
  operator: 'Entered here',
  document: 'From a document',
};

export default async function WarehousesPage() {
  const { ctx, warehouses } = await listBondedWarehouses();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bonded warehouses</h1>
        <p className="mt-1 text-sm text-slate-500">
          Filled in as jobs use them: a warehousing or ex-bond Bill of Entry names a warehouse code,
          and the code is looked up once and kept. This page is for the warehouses ICEGATE could not
          supply an address for, and the ones it got wrong.
        </p>
      </div>

      {canManage && <WarehouseForm />}

      {warehouses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          None yet. The first bonded Bill of Entry that names a warehouse will add it here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Licensed by</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Known from</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {warehouses.map((w) => (
                <tr key={w.id} className={w.is_active ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                  <td className="px-4 py-3">
                    {w.name ?? <span className="text-amber-700">not known</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {[w.address1, w.address2, w.city, w.pin].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs">{w.station_code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {w.warehouse_type ? (TYPE_LABEL[w.warehouse_type] ?? w.warehouse_type) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {SOURCE_LABEL[w.source] ?? w.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
