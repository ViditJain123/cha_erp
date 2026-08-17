'use client';

import { useActionState } from 'react';
import { NOC_STATUS_LABELS, NOC_STATUS_STYLES, type NocStatus } from '@/lib/clearance';
import { removeNoc, saveNoc, type ClearanceActionState } from './actions';
import { BUTTON, Card, Note, SMALL_FIELD } from '../ui';

const EMPTY: ClearanceActionState = {};

export interface NocRow {
  id: string;
  authority: string;
  reference: string | null;
  status: NocStatus;
  appliedOn: string | null;
  receivedOn: string | null;
}

/** The authorities that come up often enough to be worth offering. */
const COMMON_AUTHORITIES = [
  'Pollution Control Board',
  'FSSAI',
  'Plant Quarantine',
  'Animal Quarantine',
  'Drug Controller',
  'Wildlife Crime Control Bureau',
  'AQCS',
];

function NocItem({ jobId, noc }: { jobId: string; noc: NocRow }) {
  const [state, formAction, pending] = useActionState(saveNoc, EMPTY);
  const [removeState, removeAction, removing] = useActionState(removeNoc, EMPTY);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{noc.authority}</span>
          {noc.reference && (
            <span className="ml-2 font-mono text-xs text-slate-400">{noc.reference}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${NOC_STATUS_STYLES[noc.status]}`}
          >
            {NOC_STATUS_LABELS[noc.status]}
          </span>
          <form action={removeAction}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="nocId" value={noc.id} />
            <button
              type="submit"
              disabled={removing}
              aria-label={`Remove ${noc.authority}`}
              className="px-1 text-xs text-slate-400 hover:text-red-600 disabled:opacity-60"
            >
              ×
            </button>
          </form>
        </div>
      </div>
      <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="authority" value={noc.authority} />
        <select name="status" defaultValue={noc.status} className={SMALL_FIELD}>
          {Object.entries(NOC_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="reference"
          defaultValue={noc.reference ?? ''}
          placeholder="Reference"
          className={SMALL_FIELD}
        />
        <label className="text-xs text-slate-600">
          Applied
          <input
            name="appliedOn"
            type="date"
            defaultValue={noc.appliedOn ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <label className="text-xs text-slate-600">
          Received
          <input
            name="receivedOn"
            type="date"
            defaultValue={noc.receivedOn ?? ''}
            className={`ml-1 ${SMALL_FIELD}`}
          />
        </label>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>
      {(state.error ?? removeState.error) && (
        <div className="mt-2 text-xs text-red-600">{state.error ?? removeState.error}</div>
      )}
    </li>
  );
}

export function Nocs({ jobId, nocs }: { jobId: string; nocs: NocRow[] }) {
  const [state, formAction, pending] = useActionState(saveNoc, EMPTY);
  const pendingCount = nocs.filter((n) => n.status === 'pending').length;

  return (
    <Card
      title={`Clearances${pendingCount > 0 ? ` (${pendingCount} pending)` : ''}`}
      step={5}
      done={nocs.length > 0 && pendingCount === 0}
    >
      <p className="mb-3 text-xs text-slate-500">
        NOCs from other agencies — Pollution Control Board and the like. Nothing gets out of
        charge while one is pending.
      </p>

      {nocs.length > 0 && (
        <ul className="-mx-5 divide-y divide-slate-100 border-y border-slate-100">
          {nocs.map((noc) => (
            <NocItem key={noc.id} jobId={jobId} noc={noc} />
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="jobId" value={jobId} />
        <input
          name="authority"
          list="noc-authorities"
          required
          placeholder="Pollution Control Board"
          className={`min-w-56 flex-1 ${SMALL_FIELD}`}
        />
        <datalist id="noc-authorities">
          {COMMON_AUTHORITIES.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
        <select name="status" defaultValue="pending" className={SMALL_FIELD}>
          {Object.entries(NOC_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </form>
      <Note state={state} />
    </Card>
  );
}
