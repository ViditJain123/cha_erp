'use client';

import { useActionState } from 'react';
import { saveDeliveryMode, type DoActionState } from './actions';
import { Card, FIELD, LABEL, Note, PRIMARY } from '../ui';

const EMPTY: DoActionState = {};

export type SecurityReason = 'unknown' | 'none' | 'expired' | 'not_yet_valid' | 'mode' | 'covered';

/**
 * "No bond found" and "no bond exists" have to look different: the importer
 * name is free text off the documents, so a misspelling looks exactly like a
 * genuinely uncovered job — and the difference is a deposit nobody chases.
 */
const SECURITY_COPY: Record<SecurityReason, { tone: 'ok' | 'warn' | 'info'; text: string }> = {
  covered: {
    tone: 'ok',
    text: 'A bond or standing deposit covers this job, so no container deposit is due.',
  },
  none: {
    tone: 'warn',
    text: 'No bond is recorded for this importer with this line. Check the importer name matches the master before treating the deposit as payable.',
  },
  expired: {
    tone: 'warn',
    text: 'The bond on file has expired. A deposit is due unless it has been renewed.',
  },
  not_yet_valid: {
    tone: 'warn',
    text: 'The bond on file does not start until later. A deposit is due until it does.',
  },
  mode: {
    tone: 'warn',
    text: 'A bond exists but does not cover this delivery mode, so a deposit is due.',
  },
  unknown: {
    tone: 'info',
    text: 'Pick the shipping line to check whether a bond covers this job.',
  },
};

const TONES = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-slate-50 text-slate-600',
};

export function DeliveryMode({
  jobId,
  deliveryMode,
  shippingLineId,
  lines,
  securityReason,
  securityLabel,
  depositExpected,
  importerName,
}: {
  jobId: string;
  deliveryMode: string | null;
  shippingLineId: string | null;
  lines: { id: string; name: string }[];
  securityReason: SecurityReason;
  securityLabel: string | null;
  depositExpected: number | null;
  importerName: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveDeliveryMode, EMPTY);
  const copy = SECURITY_COPY[securityReason];

  return (
    <Card title="Delivery mode and security" step={3} done={deliveryMode !== null}>
      <form action={formAction} className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="jobId" value={jobId} />
        <div>
          <label htmlFor="deliveryMode" className={LABEL}>
            The cargo moves
          </label>
          <select
            id="deliveryMode"
            name="deliveryMode"
            defaultValue={deliveryMode ?? ''}
            required
            className={FIELD}
          >
            <option value="" disabled>
              Choose…
            </option>
            <option value="loaded">Loaded out — container goes to the importer</option>
            <option value="destuffed">De-stuffed at the CFS</option>
          </select>
        </div>
        <div>
          <label htmlFor="shippingLineId" className={LABEL}>
            Shipping line
          </label>
          <select
            id="shippingLineId"
            name="shippingLineId"
            defaultValue={shippingLineId ?? ''}
            className={FIELD}
          >
            <option value="">Not set</option>
            {lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={pending} className={PRIMARY}>
            {pending ? 'Checking…' : 'Save and price'}
          </button>
        </div>
      </form>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${TONES[copy.tone]}`}>
        {copy.text}
        {securityLabel && <div className="mt-1 font-medium">{securityLabel}</div>}
        {securityReason === 'none' && importerName && (
          <div className="mt-1">
            Looking for: <span className="font-medium">{importerName}</span>
          </div>
        )}
      </div>

      {depositExpected !== null && depositExpected > 0 && (
        <p className="mt-3 text-xs text-slate-600">
          Deposit expected across all containers:{' '}
          <strong>₹{depositExpected.toLocaleString('en-IN')}</strong>
        </p>
      )}

      <Note state={state} />
    </Card>
  );
}
