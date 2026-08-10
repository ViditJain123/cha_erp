import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePlatformAdmin } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { CreateCompanyForm } from './create-company-form';

export const metadata: Metadata = { title: 'Companies' };
export const dynamic = 'force-dynamic';

export default async function AdminCompaniesPage() {
  await requirePlatformAdmin();
  const db = serviceClient();

  const [{ data: companies }, { data: profiles }] = await Promise.all([
    db.from('companies').select('*').order('created_at', { ascending: false }),
    db.from('profiles').select('id, company_id, email, role, status'),
  ]);

  const byCompany = new Map<string, { members: number; owner: string | null }>();
  for (const p of profiles ?? []) {
    if (!p.company_id) continue;
    const entry = byCompany.get(p.company_id) ?? { members: 0, owner: null };
    entry.members += 1;
    if (p.role === 'company_owner') entry.owner = p.email;
    byCompany.set(p.company_id, entry);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each company is a separate tenant. Creating one also creates its owner account and emails
          them a temporary password.
        </p>
      </div>

      <CreateCompanyForm />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Members</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(companies ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No companies yet.
                </td>
              </tr>
            ) : (
              (companies ?? []).map((c) => {
                const stats = byCompany.get(c.id);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/companies/${c.id}`}
                        className="font-medium text-indigo-600 hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-slate-400">{c.slug}</div>
                    </td>
                    <td className="px-4 py-3">{stats?.owner ?? '—'}</td>
                    <td className="px-4 py-3 tabular-nums">{stats?.members ?? 0}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.status === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
