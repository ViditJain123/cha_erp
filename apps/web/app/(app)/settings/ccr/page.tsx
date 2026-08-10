import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listCcrs } from '../actions';
import { CcrImportForm } from './ccr-import-form';
import { CcrRow } from './ccr-row';

export const metadata: Metadata = { title: 'Compliance requirements' };
export const dynamic = 'force-dynamic';

export default async function CcrPage() {
  const { ctx, ccrs } = await listCcrs();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compliance requirements</h1>
        <p className="mt-1 text-sm text-slate-500">
          What each HS code obliges an importer to hold. Scrutiny reads these to work out which
          documents a shipment is missing.
        </p>
      </div>

      {canManage && <CcrImportForm />}

      {ccrs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          <div className="font-medium text-slate-700">Nothing here yet</div>
          <p className="mx-auto mt-1 max-w-md">
            Import your requirements above. Until then scrutiny has nothing to assess a shipment
            against.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">HS code</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Requirement</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ccrs.map((ccr) => (
                <CcrRow
                  key={ccr.id}
                  ccrId={ccr.id}
                  hsCode={ccr.hs_code}
                  code={ccr.code}
                  title={ccr.title}
                  requirementText={ccr.requirement_text}
                  isActive={ccr.is_active}
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
