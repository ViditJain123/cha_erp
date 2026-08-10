'use client';

import { useActionState } from 'react';
import { importCcrs, type SettingsActionState } from '../actions';
import { Feedback } from '../feedback';

const EMPTY: SettingsActionState = {};

const SAMPLE = `3304,FSSAI-01,FSSAI registration,"Cosmetics require FSSAI import registration and a certificate of analysis for each batch."
0902,PQ-01,Phytosanitary certificate,"Plant products require a phytosanitary certificate from the country of origin."`;

export function CcrImportForm() {
  const [state, formAction, pending] = useActionState(importCcrs, EMPTY);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Import requirements</h2>
      <p className="mt-1 text-sm text-slate-500">
        Four columns: HS code, requirement code, title, requirement text. The HS code is a prefix —{' '}
        <code className="rounded bg-slate-100 px-1">3304</code> applies to everything under that
        heading. Re-importing the same HS code and requirement code updates it.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <textarea
          id="csv"
          name="csv"
          rows={6}
          spellCheck={false}
          placeholder={SAMPLE}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? 'Importing…' : 'Import'}
        </button>
      </form>

      <Feedback state={state} />
    </div>
  );
}
