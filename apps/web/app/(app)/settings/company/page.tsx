import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { requireCompany } from '@/lib/auth';
import { serviceForCompany } from '@/lib/supabase/admin';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Company' };
export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage() {
  const ctx = await requireCompany();
  const { data: company } = await serviceForCompany(ctx.companyId).company();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company</h1>
        <p className="mt-1 text-sm text-slate-500">
          Setup is intentionally minimal for now — more fields arrive alongside job numbering.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {canManage ? (
          <CompanyForm name={company?.name ?? ''} slug={company?.slug ?? ''} />
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Name</dt>
              <dd className="mt-1">{company?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Identifier</dt>
              <dd className="mt-1 font-mono text-xs">{company?.slug ?? '—'}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
