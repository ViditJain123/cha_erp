import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listBranches } from '../actions';
import { BranchForm } from './branch-form';
import { BranchRow } from './branch-row';

export const metadata: Metadata = { title: 'Branches' };
export const dynamic = 'force-dynamic';

export default async function BranchesPage() {
  const { ctx, branches } = await listBranches();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Branches</h1>
        <p className="mt-1 text-sm text-slate-500">
          The offices you clear through. Every job is filed against one, chosen when the checklist
          comes back from Logi-Sys.
        </p>
      </div>

      {canManage && <BranchForm />}

      {branches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No branches yet. Add the first one above — a job cannot leave the documents branch without
          it.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {branches.map((branch) => (
                <BranchRow
                  key={branch.id}
                  branchId={branch.id}
                  name={branch.name}
                  code={branch.code}
                  isActive={branch.is_active}
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
