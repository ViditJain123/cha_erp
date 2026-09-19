import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listSupplierRelationships } from '../actions';
import { RelationshipForm } from './relationship-form';
import { RelationshipRow } from './relationship-row';

export const metadata: Metadata = { title: 'Related parties & SVB' };
export const dynamic = 'force-dynamic';

export default async function RelationshipsPage() {
  const { ctx, relationships } = await listSupplierRelationships();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Related parties &amp; SVB</h1>
        <p className="mt-1 text-sm text-slate-500">
          Whether one of your importers is related to one of its suppliers, and under what Special
          Valuation Branch order. Every Bill of Entry declares this on the INVOICES sheet, and
          without a record here it declares nothing — which is the honest answer, because nobody has
          said.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Kept per <span className="font-medium">pair</span>. The same overseas supplier can be a
          related party to one importer and at arm&rsquo;s length from another, so the answer is not
          a property of the supplier.
        </p>
      </div>

      {canManage && <RelationshipForm />}

      {relationships.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Nothing recorded. Every Bill of Entry will leave <code>Is_Related</code> and the whole SVB
          block empty until a pair is added here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Importer</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Related</th>
                <th className="px-4 py-3">SVB order</th>
                <th className="px-4 py-3">Loading</th>
                <th className="px-4 py-3">RD</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {relationships.map((r) => (
                <RelationshipRow
                  key={r.id}
                  id={r.id}
                  importerName={r.importer?.name ?? '—'}
                  importerBranch={r.importer?.branch_name ?? ''}
                  supplierName={r.supplier?.name ?? '—'}
                  supplierBranch={r.supplier?.branch_name ?? ''}
                  isRelated={r.is_related}
                  base={r.base}
                  condition={r.condition}
                  svbRefNo={r.svb_ref_no}
                  svbDate={r.svb_date}
                  svbCustomHouse={r.svb_custom_house}
                  loadingBasis={r.svb_loading_basis}
                  rateAssessable={r.svb_rate_assessable}
                  statusAssessable={r.svb_status_assessable}
                  rateDuty={r.svb_rate_duty}
                  statusDuty={r.svb_status_duty}
                  revenueDepositPercent={r.revenue_deposit_percent}
                  notes={r.notes}
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
