import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES, ROLES, TEAMS } from '@checklist/config/app';
import { listTeam } from '../actions';
import { InviteMemberForm } from './invite-member-form';
import { MemberRow } from './member-row';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { ctx, members } = await listTeam();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="mt-1 text-sm text-slate-500">
          {TEAMS.scrutiny.description} {TEAMS.do.description}
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
                team={m.team ? TEAMS[m.team].label : '—'}
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
