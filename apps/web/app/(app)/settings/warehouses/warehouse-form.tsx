'use client';

import { useActionState } from 'react';
import { saveBondedWarehouse } from '../actions';
import type { SettingsActionState } from '../actions';

const FIELD =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
const LABEL = 'mb-1 block text-xs font-medium text-slate-600';

/**
 * Add or correct a bonded warehouse.
 *
 * Upserts on the code, so the same form adds a warehouse ICEGATE could not
 * supply and fixes one it supplied wrongly.
 */
export function WarehouseForm() {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    saveBondedWarehouse,
    {},
  );

  return (
    <form action={action} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Add or correct a warehouse</h2>
      <p className="mb-4 text-xs text-slate-500">
        The code is checked against the customs station master before anything is saved — its first
        four characters name the port that licensed the warehouse.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={LABEL} htmlFor="code">
            Warehouse code
          </label>
          <input className={FIELD} id="code" name="code" placeholder="MAA1U001" required />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="name">
            Name
          </label>
          <input className={FIELD} id="name" name="name" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="address1">
            Address line 1
          </label>
          <input className={FIELD} id="address1" name="address1" />
        </div>
        <div>
          <label className={LABEL} htmlFor="address2">
            Address line 2
          </label>
          <input className={FIELD} id="address2" name="address2" />
        </div>
        <div>
          <label className={LABEL} htmlFor="city">
            City
          </label>
          <input className={FIELD} id="city" name="city" />
        </div>
        <div>
          <label className={LABEL} htmlFor="pin">
            PIN
          </label>
          <input className={FIELD} id="pin" name="pin" />
        </div>
        <div>
          <label className={LABEL} htmlFor="licenseNo">
            Licence number
          </label>
          <input className={FIELD} id="licenseNo" name="licenseNo" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="licenseeName">
            Licensee
          </label>
          <input className={FIELD} id="licenseeName" name="licenseeName" />
        </div>
        <div>
          <label className={LABEL} htmlFor="licenseValidTill">
            Licence valid till
          </label>
          <input className={FIELD} id="licenseValidTill" name="licenseValidTill" type="date" />
        </div>
      </div>

      <button
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Saving…' : 'Save warehouse'}
      </button>

      {state.error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {state.error}
        </div>
      )}
      {state.message && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {state.message}
        </div>
      )}
    </form>
  );
}
