'use client';

/**
 * The delivery-order and clearance tabs are two dozen small forms between them,
 * so the class strings the scrutiny panel hoists to module consts live here
 * instead of being copied into every one.
 */

/**
 * What every action on those tabs returns. Declared here rather than imported
 * from either tab's `actions.ts` so this module belongs to neither — both
 * `DoActionState` and `ClearanceActionState` are assignable to it.
 */
export interface ActionNote {
  ok?: boolean;
  error?: string;
  message?: string;
}
export const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
export const SMALL_FIELD =
  'rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
export const LABEL = 'mb-1 block text-xs font-medium text-slate-600';
export const BUTTON =
  'rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-60';
export const PRIMARY =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60';

export function Note({ state }: { state: ActionNote }) {
  if (state.error) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {state.error}
      </div>
    );
  }
  if (!state.message) return null;
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
      {state.message}
    </div>
  );
}

export function Card({
  title,
  step,
  done,
  children,
}: {
  title: string;
  step?: number;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        {step !== undefined && (
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
              done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {done ? '✓' : step}
          </span>
        )}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}
