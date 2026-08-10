'use client';

import { useActionState } from 'react';
import { TEAMS } from '@checklist/config/app';
import { inviteMember, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

export function InviteMemberForm({ canAddAdmins }: { canAddAdmins: boolean }) {
  const [state, formAction, pending] = useActionState(inviteMember, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Add a team member</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500">
        They receive a temporary password by email and choose their own on first sign-in.
      </p>

      <form action={formAction} className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="fullName" className="mb-1 block text-xs font-medium text-slate-600">
            Name <span className="text-slate-400">(optional)</span>
          </label>
          <input
            id="fullName"
            name="fullName"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="team" className="mb-1 block text-xs font-medium text-slate-600">
            Team
          </label>
          <select
            id="team"
            name="team"
            defaultValue="scrutiny"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="scrutiny">{TEAMS.scrutiny.label}</option>
            <option value="do">{TEAMS.do.label}</option>
          </select>
        </div>
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-slate-600">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue="member"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="member">Member</option>
            {canAddAdmins && <option value="company_admin">Admin</option>}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>

      <Feedback state={state} />
    </div>
  );
}
