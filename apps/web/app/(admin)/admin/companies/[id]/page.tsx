import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TEAMS, ROLES } from '@checklist/config/app';
import { requirePlatformAdmin } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { UserRow } from './user-row';

export const metadata: Metadata = { title: 'Company' };
export const dynamic = 'force-dynamic';

export default async function AdminCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const db = serviceClient();

  const { data: company } = await db.from('companies').select('*').eq('id', id).maybeSingle();
  if (!company) notFound();

  const { data: members } = await db
    .from('profiles')
    .select('*')
    .eq('company_id', id)
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-indigo-600 hover:underline">
          ← Companies
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{company.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {company.slug} · created {new Date(company.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(members ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No members.
                </td>
              </tr>
            ) : (
              (members ?? []).map((m) => (
                <UserRow
                  key={m.id}
                  userId={m.id}
                  email={m.email}
                  fullName={m.full_name}
                  role={ROLES[m.role].label}
                  team={m.team ? TEAMS[m.team].label : '—'}
                  status={m.status}
                  mustChangePassword={m.must_change_password}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
