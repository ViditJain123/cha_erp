import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listSecurities } from '../actions';
import { SecurityForm } from './security-form';
import { SecurityRow } from './security-row';

export const metadata: Metadata = { title: 'Securities' };
export const dynamic = 'force-dynamic';

export default async function SecuritiesPage() {
  const { ctx, securities, lines } = await listSecurities();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);
  const lineName = new Map(lines.map((l) => [l.id, l.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bonds and standing deposits</h1>
        <p className="mt-1 text-sm text-slate-500">
          What an importer already has lodged with a shipping line. A job whose importer matches one
          of these does not need a container deposit, so the DO tab stops asking for one.
        </p>
      </div>

      {canManage && <SecurityForm lines={lines.filter((l) => l.is_active)} />}

      {securities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          Nothing recorded. Every job will be treated as needing a deposit until something is added
          here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Importer</th>
                <th className="px-4 py-3">Line</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Covers</th>
                <th className="px-4 py-3">Valid to</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {securities.map((security) => (
                <SecurityRow
                  key={security.id}
                  securityId={security.id}
                  importerName={security.importer_name}
                  importerAliases={security.importer_aliases}
                  lineName={lineName.get(security.shipping_line_id) ?? '—'}
                  kind={security.kind}
                  reference={security.reference}
                  amount={security.amount}
                  validTo={security.valid_to}
                  coversLoaded={security.covers_loaded}
                  coversDestuffed={security.covers_destuffed}
                  isActive={security.is_active}
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
