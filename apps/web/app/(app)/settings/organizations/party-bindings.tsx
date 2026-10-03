'use client';

import { useActionState } from 'react';
import { deletePartyBinding, type SettingsActionState } from '../actions';

const EMPTY: SettingsActionState = {};

export interface BindingRow {
  id: string;
  role: string;
  source_name: string;
  decided_at: string;
  organizations: {
    name: string;
    branch_name: string;
    city: string | null;
    ad_code: string | null;
  } | null;
}

/**
 * The names someone has already decided about.
 *
 * A party whose name matches several repository branches is a question only an
 * operator can answer, and the answer is the same on every job of that
 * importer — 479 of the repository's 3,790 distinct name keys have more than
 * one branch, and the branch names are frequently just numbers. So the choice
 * is kept, and this is where it is visible and undoable.
 *
 * Undoable is the part that matters. A binding answers a question nobody will
 * be asked again, so a wrong one is invisible and wrong on every job after it
 * until someone can find it and say so.
 */
export function PartyBindings({
  bindings,
  canManage,
}: {
  bindings: BindingRow[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState(deletePartyBinding, EMPTY);

  if (bindings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-5 py-4 text-sm text-slate-500">
        <span className="font-medium text-slate-700">Remembered parties</span> — nothing yet. When a
        name on the documents matches several branches, pick the right one on the job and tick
        &ldquo;remember&rdquo;, and it will be answered here from then on.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold">Remembered parties</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {bindings.length} name{bindings.length === 1 ? '' : 's'} off the documents that someone has
          bound to a specific branch. Every job reading one of these names gets that branch without
          asking.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {bindings.map((binding) => (
          <li key={binding.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
            <span className="text-sm font-medium">{binding.source_name}</span>
            <span className="text-xs text-slate-400">as {binding.role}</span>
            <span className="text-sm text-slate-600">&rarr; {binding.organizations?.name ?? '—'}</span>
            <span className="text-xs text-slate-500">
              {[
                binding.organizations?.branch_name && `branch ${binding.organizations.branch_name}`,
                binding.organizations?.city,
                binding.organizations?.ad_code && `AD ${binding.organizations.ad_code}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <span className="flex-1" />
            <span className="text-xs text-slate-400">
              {new Date(binding.decided_at).toLocaleDateString()}
            </span>
            {canManage && (
              <form action={formAction}>
                <input type="hidden" name="id" value={binding.id} />
                <button type="submit" className="text-xs text-red-600 hover:text-red-800">
                  forget
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {(state.error ?? state.message) && (
        <p
          className={`border-t border-slate-200 px-5 py-2 text-xs ${state.error ? 'text-red-700' : 'text-emerald-700'}`}
        >
          {state.error ?? state.message}
        </p>
      )}
    </div>
  );
}
