'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChecklistDraft, DraftFlag } from '@checklist/extraction';
import type { JobRecord } from '@/lib/store';

/* ---------- small helpers ---------- */

function setPath(obj: unknown, path: string, value: unknown) {
  const keys = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys[keys.length - 1]!] = value;
}

const SEV_STYLE: Record<DraftFlag['severity'], string> = {
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-sky-50 border-sky-200 text-sky-800',
};
const SEV_ICON: Record<DraftFlag['severity'], string> = { error: '⛔', warning: '⚠️', info: 'ℹ️' };

const inr = (v: number | undefined | null) =>
  v == null ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ---------- field primitives ---------- */

interface FieldProps {
  label: string;
  value: string | number | undefined | null;
  onChange?: (v: string) => void;
  flagged?: 'error' | 'warning' | undefined;
  type?: 'text' | 'number' | 'date';
  readOnly?: boolean;
  className?: string;
}

function Field({ label, value, onChange, flagged, type = 'text', readOnly, className }: FieldProps) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`w-full rounded-md border px-2 py-1.5 text-sm ${
          flagged === 'error'
            ? 'border-red-400 bg-red-50 ring-1 ring-red-300'
            : flagged === 'warning'
              ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
              : 'border-slate-300 bg-white'
        } ${readOnly ? 'bg-slate-50 text-slate-500' : ''} focus:outline-none focus:ring-2 focus:ring-indigo-400`}
      />
    </label>
  );
}

function Select({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      {children}
    </section>
  );
}

/* ---------- main view ---------- */

export default function JobView({ initialJob }: { initialJob: JobRecord }) {
  const [job, setJob] = useState<JobRecord>(initialJob);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // poll while the pipeline runs
  useEffect(() => {
    if (job.status !== 'processing') return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/legacy/jobs/${job.id}`);
      if (res.ok) {
        const fresh = (await res.json()) as JobRecord;
        if (fresh.status !== 'processing') setJob(fresh);
      }
    }, 2500);
    return () => clearInterval(t);
  }, [job.status, job.id]);

  const draft = job.draft;

  const edit = useCallback((path: string, value: unknown) => {
    setJob((prev) => {
      if (!prev.draft) return prev;
      const next = structuredClone(prev);
      setPath(next.draft, path, value);
      return next;
    });
    setDirty(true);
  }, []);

  const editNum = useCallback((path: string) => (v: string) => edit(path, v === '' ? 0 : Number(v)), [edit]);
  const editStr = useCallback((path: string) => (v: string) => edit(path, v), [edit]);

  const flaggedPaths = useMemo(() => {
    const m = new Map<string, 'error' | 'warning'>();
    for (const f of draft?.flags ?? []) {
      if (f.path && f.severity !== 'info' && !m.has(f.path)) m.set(f.path, f.severity);
    }
    return m;
  }, [draft?.flags]);
  const flag = (p: string) => flaggedPaths.get(p);

  async function save(): Promise<JobRecord | null> {
    if (!draft) return null;
    setBusy('Saving…');
    const res = await fetch(`/api/legacy/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    setBusy(null);
    if (!res.ok) {
      alert(`Save failed: ${await res.text()}`);
      return null;
    }
    const fresh = (await res.json()) as JobRecord;
    setJob(fresh);
    setDirty(false);
    return fresh;
  }

  async function approve() {
    const saved = dirty ? await save() : job;
    if (!saved) return;
    setBusy('Generating PDF…');
    const res = await fetch(`/api/legacy/jobs/${job.id}/approve`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) {
      alert(`PDF generation failed: ${await res.text()}`);
      return;
    }
    const fresh = (await (await fetch(`/api/legacy/jobs/${job.id}`)).json()) as JobRecord;
    setJob(fresh);
    window.open(`/api/legacy/jobs/${job.id}/pdf`, '_blank');
  }

  if (job.status === 'processing') {
    return (
      <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white p-20 text-center shadow-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="mt-4 font-medium">Reading documents…</p>
        <p className="mt-1 text-sm text-slate-500">
          Classifying {job.fileNames.length} file{job.fileNames.length === 1 ? '' : 's'}, extracting data and applying
          duty masters. Usually 20–40 seconds.
        </p>
      </div>
    );
  }

  if (job.status === 'failed' || !draft) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-10 text-center">
        <p className="font-medium text-red-800">Processing failed</p>
        <p className="mt-2 text-sm text-red-700">{job.error ?? 'No draft was produced.'}</p>
      </div>
    );
  }

  const duty = draft.duty;

  return (
    <div className="pb-24">
      {/* header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {job.jobNumber}
            <span className="ml-3 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
              {draft.transportMode} · {draft.customStation.name}
            </span>
            {job.status === 'approved' && (
              <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">approved</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Sources:{' '}
            {job.fileNames.map((f) => (
              <a key={f} className="mr-2 text-indigo-600 hover:underline" target="_blank" href={`/api/legacy/jobs/${job.id}/files/${encodeURIComponent(f)}`}>
                {f}
              </a>
            ))}
          </p>
        </div>
        <div className="flex gap-2">
          {job.status === 'approved' && (
            <a href={`/api/legacy/jobs/${job.id}/pdf`} target="_blank" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50">
              View PDF
            </a>
          )}
          <button
            onClick={save}
            disabled={!dirty || !!busy}
            className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
          >
            Save & recompute
          </button>
          <button
            onClick={approve}
            disabled={!!busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ?? 'Approve → Checklist PDF'}
          </button>
        </div>
      </div>

      {/* flags */}
      {draft.flags.length > 0 && (
        <div className="mb-5 space-y-1.5">
          {[...draft.flags]
            .sort((a, b) => ['error', 'warning', 'info'].indexOf(a.severity) - ['error', 'warning', 'info'].indexOf(b.severity))
            .map((f, i) => (
              <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-1.5 text-xs ${SEV_STYLE[f.severity]}`}>
                <span>{SEV_ICON[f.severity]}</span>
                <span>{f.message}</span>
              </div>
            ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="General">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Select label="Filing status" value={draft.filingStatus} options={['Normal', 'Prior', 'Advance']} onChange={editStr('filingStatus')} />
              <Field label="Custom station" value={draft.customStation.name} onChange={editStr('customStation.name')} flagged={flag('customStation')} />
              <Field label="Station code" value={draft.customStation.code} onChange={editStr('customStation.code')} flagged={flag('customStation')} />
              <Field label="Country of origin" value={draft.shipment.countryOfOrigin} onChange={editStr('shipment.countryOfOrigin')} flagged={flag('shipment.countryOfOrigin')} />
            </div>
          </Card>

          <Card title="Importer">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field className="col-span-2" label="Name" value={draft.importer.name} onChange={editStr('importer.name')} flagged={flag('importer')} />
              <Field label="IEC" value={draft.importer.iec} onChange={editStr('importer.iec')} flagged={flag('importer')} />
              <Field label="GSTIN" value={draft.importer.gstin} onChange={editStr('importer.gstin')} flagged={flag('importer')} />
              <Field label="PAN" value={draft.importer.pan} onChange={editStr('importer.pan')} flagged={flag('importer')} />
              <Field label="AD Code" value={draft.importer.adCode} onChange={editStr('importer.adCode')} flagged={flag('importer')} />
            </div>
            {!draft.importer.matchedFromMasters && (
              <p className="mt-2 text-xs text-amber-700">Importer was not found in masters — the details entered here will seed the importer directory.</p>
            )}
          </Card>

          <Card title="Shipment">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {draft.transportMode === 'Air' ? (
                <>
                  <Field label="MAWB No" value={draft.shipment.mawbNo} onChange={editStr('shipment.mawbNo')} />
                  <Field label="MAWB date" value={draft.shipment.mawbDate} onChange={editStr('shipment.mawbDate')} type="date" />
                  <Field label="HAWB No" value={draft.shipment.hawbNo} onChange={editStr('shipment.hawbNo')} />
                </>
              ) : (
                <>
                  <Field label="BL No" value={draft.shipment.blNo} onChange={editStr('shipment.blNo')} />
                  <Field label="BL date" value={draft.shipment.blDate} onChange={editStr('shipment.blDate')} type="date" />
                  <Field label="HBL No" value={draft.shipment.hblNo} onChange={editStr('shipment.hblNo')} />
                </>
              )}
              <Field label="IGM No" value={draft.shipment.igmNo} onChange={editStr('shipment.igmNo')} />
              <Field label="IGM date" value={draft.shipment.igmDate} onChange={editStr('shipment.igmDate')} type="date" />
              <Field label="ETA" value={draft.shipment.eta} onChange={editStr('shipment.eta')} type="date" flagged={flag('shipment.eta')} />
              <Field label="Port of loading" value={draft.shipment.portOfLoading} onChange={editStr('shipment.portOfLoading')} />
              <Field label="Consignment country" value={draft.shipment.consCountry} onChange={editStr('shipment.consCountry')} />
              <Field label="Gross weight (kg)" value={draft.shipment.grossWeightKg} onChange={editNum('shipment.grossWeightKg')} type="number" flagged={flag('shipment.grossWeightKg')} />
              <Field label="Packages" value={draft.shipment.packageCount} onChange={editNum('shipment.packageCount')} type="number" />
              <Field label="Package unit" value={draft.shipment.packageUnit} onChange={editStr('shipment.packageUnit')} />
              <Field label="Vessel / flight" value={draft.shipment.vesselOrFlight} onChange={editStr('shipment.vesselOrFlight')} />
            </div>
            {draft.shipment.containers.length > 0 && (
              <p className="mt-3 text-xs text-slate-500">
                Containers: {draft.shipment.containers.map((c) => `${c.number} (${c.sizeType ?? '?'}${c.sealNo ? `, seal ${c.sealNo}` : ''})`).join(' · ')}
              </p>
            )}
          </Card>

          <Card title="Invoice & valuation">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label="Invoice No" value={draft.invoice.invoiceNumber} onChange={editStr('invoice.invoiceNumber')} flagged={flag('invoice.invoiceNumber')} />
              <Field label="Invoice date" value={draft.invoice.invoiceDate} onChange={editStr('invoice.invoiceDate')} type="date" />
              <Select label="TOI" value={draft.invoice.termsOfInvoice} options={['FOB', 'CIF', 'C&F']} onChange={editStr('invoice.termsOfInvoice')} />
              <Field label={`Invoice value (${draft.invoice.currency})`} value={draft.invoice.invoiceValue} onChange={editNum('invoice.invoiceValue')} type="number" />
              <Field
                label={`Misc charges (${draft.invoice.miscCharges?.currency ?? draft.invoice.currency})`}
                value={draft.invoice.miscCharges?.amount ?? 0}
                onChange={(v) => edit('invoice.miscCharges', Number(v) > 0 ? { amount: Number(v), currency: draft.invoice.miscCharges?.currency ?? draft.invoice.currency } : undefined)}
                type="number"
              />
              <Field
                label="Insurance (INR)"
                value={draft.invoice.insurance?.kind === 'amount' ? draft.invoice.insurance.value.amount : 0}
                onChange={(v) => edit('invoice.insurance', Number(v) > 0 ? { kind: 'amount', value: { amount: Number(v), currency: 'INR' } } : undefined)}
                type="number"
                flagged={flag('invoice.insurance')}
              />
              <Field label={`Exch. rate (${draft.invoiceMeta.exchangeRate.currency})`} value={draft.invoiceMeta.exchangeRate.rate} onChange={editNum('invoiceMeta.exchangeRate.rate')} type="number" />
              <Field label="Terms of payment" value={draft.invoiceMeta.termsOfPayment} onChange={editStr('invoiceMeta.termsOfPayment')} />
            </div>
          </Card>

          <Card title={`Items (${draft.items.length})`}>
            <div className="space-y-4">
              {draft.items.map((it, i) => {
                const r = duty?.items[i];
                return (
                  <div key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">ITEM {it.slNo}</span>
                      {r && <span className="text-xs text-slate-500">AV {inr(r.assessableValue)} · duty {inr(r.totalDuty)}</span>}
                    </div>
                    <textarea
                      value={it.description}
                      onChange={(e) => edit(`items.${i}.description`, e.target.value)}
                      rows={2}
                      className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                      <Field label="RITC / CTH" value={it.ritc} onChange={editStr(`items.${i}.ritc`)} flagged={flag(`items.${i}.ritc`)} />
                      <Field label="Qty" value={it.quantity} onChange={editNum(`items.${i}.quantity`)} type="number" flagged={flag(`items.${i}.quantity`)} />
                      <Field label="Unit" value={it.unit} onChange={editStr(`items.${i}.unit`)} />
                      <Field label="Unit price" value={it.unitPrice} onChange={editNum(`items.${i}.unitPrice`)} type="number" />
                      <Field label="BCD %" value={it.bcdRate} onChange={editNum(`items.${i}.bcdRate`)} type="number" />
                      <Field label="IGST %" value={it.igstRate} onChange={editNum(`items.${i}.igstRate`)} type="number" />
                    </div>
                    {it.bcdExemption && (
                      <p className="mt-2 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        FTA: {it.bcdExemption.scheme} · notification {it.bcdExemption.notification} {it.bcdExemption.serial} · {it.bcdExemption.percent}% BCD exemption
                        <button className="ml-2 text-emerald-600 underline" onClick={() => edit(`items.${i}.bcdExemption`, undefined)}>
                          remove
                        </button>
                      </p>
                    )}
                    {it.batch && (
                      <p className="mt-1 text-xs text-slate-500">
                        Batch {it.batch.batchNo ?? '?'} · mfg {it.batch.manufactureDate ?? '?'} · exp {it.batch.expiryDate ?? '?'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* duty summary sidebar */}
        <div className="space-y-5">
          <div className="sticky top-6 space-y-5">
            <Card title="Duty summary">
              {duty ? (
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Assessable value</dt><dd className="font-medium tabular-nums">{inr(duty.totalAssessableValue)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Basic Customs Duty</dt><dd className="tabular-nums">{inr(duty.totals.bcd)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Social Welfare Surcharge</dt><dd className="tabular-nums">{inr(duty.totals.sws)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">IGST</dt><dd className="tabular-nums">{inr(duty.totals.igst)}</dd></div>
                  {duty.totals.aidc > 0 && <div className="flex justify-between"><dt className="text-slate-500">AIDC</dt><dd className="tabular-nums">{inr(duty.totals.aidc)}</dd></div>}
                  {duty.totals.compCess > 0 && <div className="flex justify-between"><dt className="text-slate-500">Comp. cess</dt><dd className="tabular-nums">{inr(duty.totals.compCess)}</dd></div>}
                  <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base">
                    <dt className="font-semibold">Duty payable</dt>
                    <dd className="font-semibold tabular-nums">₹{duty.dutyPayable.toLocaleString('en-IN')}</dd>
                  </div>
                  <p className="pt-1 text-xs italic text-slate-500">{duty.dutyPayableInWords}</p>
                </dl>
              ) : (
                <p className="text-sm text-slate-500">Duty not computed — fix the flagged fields and save.</p>
              )}
              {dirty && <p className="mt-3 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">Unsaved edits — totals refresh on save.</p>}
            </Card>

            <Card title="Declarations">
              <ul className="list-inside space-y-1 text-xs text-slate-600">
                {draft.declarations.map((dec) => (
                  <li key={dec.code}><b>{dec.code}</b> — {dec.text.slice(0, 80)}…</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
