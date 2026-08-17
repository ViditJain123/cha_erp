import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES, ROLES, TEAMS } from '@checklist/config/app';
import { listTeam } from '../actions';
import { InviteMemberForm } from './invite-member-form';
import { MemberRow } from './member-row';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { ctx, members, cfsOptions } = await listTeam();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);
  const cfsName = new Map(cfsOptions.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="mt-1 text-sm text-slate-500">
          Which desk each person works. A CFS member also needs a station — they only see
          delivery plans raised against it.
        </p>
      </div>

      {canManage && <InviteMemberForm canAddAdmins={ctx.role === 'company_owner'} />}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Member</th>
              <th className="px-4 py-3">Team</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                userId={m.id}
                email={m.email}
                fullName={m.full_name}
                team={m.team}
                teamLabel={m.team ? TEAMS[m.team].label : '—'}
                cfsId={m.cfs_id}
                cfsLabel={m.cfs_id ? (cfsName.get(m.cfs_id) ?? 'Unknown CFS') : null}
                cfsOptions={cfsOptions}
                role={ROLES[m.role].label}
                status={m.status}
                isOwner={m.role === 'company_owner'}
                isSelf={m.id === ctx.userId}
                canManage={canManage}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
