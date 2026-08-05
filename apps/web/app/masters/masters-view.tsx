'use client';

import { useState } from 'react';
import type {
  ExchangeRateMaster,
  ImporterMaster,
  ProductMemory,
  TariffMaster,
} from '@checklist/core';
import type { ExchangeRateParse, NotificationParse } from '@checklist/extraction';

interface MastersData {
  tariff: TariffMaster[];
  importers: ImporterMaster[];
  exchangeRates: ExchangeRateMaster[];
  productMemory: ProductMemory[];
}

const TABS = ['Tariff', 'Importers', 'Exchange rates', 'Notifications', 'Job memory'] as const;
type Tab = (typeof TABS)[number];

async function refresh(): Promise<MastersData> {
  return (await (await fetch('/api/masters')).json()) as MastersData;
}

export default function MastersView({ initial }: { initial: MastersData }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>('Tariff');

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Masters</h1>
      <p className="mb-5 text-sm text-slate-500">
        Duty & reference data used to auto-fill checklists. Approved jobs teach these tables automatically.
      </p>
      <div className="mb-5 flex gap-1 rounded-lg bg-slate-200 p-1 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${tab === t ? 'bg-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Tariff' && <TariffTab rows={data.tariff} onChanged={async () => setData(await refresh())} />}
      {tab === 'Importers' && <ImportersTab rows={data.importers} />}
      {tab === 'Exchange rates' && <RatesTab tables={data.exchangeRates} onChanged={async () => setData(await refresh())} />}
      {tab === 'Notifications' && <NotificationsTab onChanged={async () => setData(await refresh())} />}
      {tab === 'Job memory' && <MemoryTab rows={data.productMemory} onChanged={async () => setData(await refresh())} />}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2">{children}</td>;
}

/* ---------------- Tariff ---------------- */

function TariffTab({ rows, onChanged }: { rows: TariffMaster[]; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ cth: '', description: '', bcdRate: '', igstRate: '' });
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    const res = await fetch('/api/masters/tariff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cth: form.cth.trim(),
        description: form.description.trim(),
        bcdRate: Number(form.bcdRate),
        igstRate: Number(form.igstRate),
      }),
    });
    setBusy(false);
    if (!res.ok) return alert(await res.text());
    setForm({ cth: '', description: '', bcdRate: '', igstRate: '' });
    await onChanged();
  }

  return (
    <Panel>
      <table className="w-full text-sm">
        <thead><tr><Th>CTH</Th><Th>Description</Th><Th>BCD %</Th><Th>IGST %</Th><Th>IGST notn</Th><Th>PGA</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.cth}>
              <Td><span className="font-mono">{r.cth}</span></Td>
              <Td>{r.description}</Td>
              <Td>{r.bcdRate}%</Td>
              <Td>{r.igstRate}%</Td>
              <Td>{r.igstNotification}</Td>
              <Td>{r.pga ?? ''}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
        <input placeholder="CTH (8 digits)" value={form.cth} onChange={(e) => setForm({ ...form, cth: e.target.value })} className="w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <input placeholder="BCD %" value={form.bcdRate} onChange={(e) => setForm({ ...form, bcdRate: e.target.value })} className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <input placeholder="IGST %" value={form.igstRate} onChange={(e) => setForm({ ...form, igstRate: e.target.value })} className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
        <button onClick={add} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
          Add / update
        </button>
      </div>
    </Panel>
  );
}

/* ---------------- Importers ---------------- */

function ImportersTab({ rows }: { rows: ImporterMaster[] }) {
  return (
    <Panel>
      <table className="w-full text-sm">
        <thead><tr><Th>Name</Th><Th>IEC</Th><Th>GSTIN</Th><Th>AD Code</Th><Th>State</Th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.gstin || r.name}>
              <Td>{r.name}</Td>
              <Td><span className="font-mono">{r.iec}</span></Td>
              <Td><span className="font-mono">{r.gstin}</span></Td>
              <Td>{r.adCode}</Td>
              <Td>{r.gstStateName}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-slate-500">New importers are added automatically when a job with an unknown importer is approved.</p>
    </Panel>
  );
}

/* ---------------- Exchange rates ---------------- */

function RatesTab({ tables, onChanged }: { tables: ExchangeRateMaster[]; onChanged: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ExchangeRateParse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function parse() {
    setBusy('Parsing…');
    const res = await fetch('/api/masters/exchange-rates/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    setParsed((await res.json()) as ExchangeRateParse);
  }

  async function save() {
    if (!parsed) return;
    setBusy('Saving…');
    const res = await fetch('/api/masters/exchange-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        effectiveFrom: parsed.effectiveFrom,
        rates: Object.fromEntries(parsed.rates.map((r) => [r.currency, r.importRate])),
      }),
    });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    setParsed(null);
    setText('');
    await onChanged();
  }

  return (
    <div className="space-y-4">
      <Panel>
        <h3 className="mb-2 text-sm font-semibold">Update from CBIC / ICEGATE notification</h3>
        <p className="mb-2 text-xs text-slate-500">
          Paste the fortnightly exchange-rate table text from ICEGATE (ERAM). AI parses it; you confirm before it goes live.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="Paste the rate table here…"
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button onClick={parse} disabled={!text.trim() || !!busy} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40">
            {busy ?? 'Parse with AI'}
          </button>
          {parsed && (
            <button onClick={save} disabled={!!busy} className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
              Save table (effective {parsed.effectiveFrom})
            </button>
          )}
        </div>
        {parsed && (
          <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-800">
            Parsed {parsed.rates.length} currencies: {parsed.rates.map((r) => `${r.currency} ${r.importRate}`).join(' · ')}
            {parsed.notes ? ` — ${parsed.notes}` : ''}
          </p>
        )}
      </Panel>
      <Panel>
        <table className="w-full text-sm">
          <thead><tr><Th>Effective from</Th><Th>Rates (INR per unit, import)</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {[...tables].reverse().map((t) => (
              <tr key={t.effectiveFrom}>
                <Td>{t.effectiveFrom}</Td>
                <Td>
                  <span className="font-mono text-xs">
                    {Object.entries(t.rates).map(([c, r]) => `${c} ${r}`).join(' · ')}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/* ---------------- Notifications ---------------- */

function NotificationsTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const [parsed, setParsed] = useState<NotificationParse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy('Parsing notification…');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/masters/notifications/parse', { method: 'POST', body: form });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    setParsed((await res.json()) as NotificationParse);
  }

  async function accept(p: NotificationParse['proposals'][number]) {
    if (!/^\d{8}$/.test(p.cth)) return alert('Only 8-digit CTH rows can be saved to the tariff master.');
    setBusy('Saving…');
    const res = await fetch('/api/masters/tariff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cth: p.cth,
        description: p.description,
        bcdRate: p.bcdRate ?? 0,
        igstRate: p.igstRate ?? 0,
      }),
    });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    await onChanged();
    alert(`Saved ${p.cth} to tariff master.`);
  }

  return (
    <Panel>
      <h3 className="mb-2 text-sm font-semibold">Ingest a CBIC notification PDF</h3>
      <p className="mb-3 text-xs text-slate-500">
        Upload a customs notification (budget tariff change, exemption, IGST schedule). AI proposes tariff rows; accept the ones that apply.
      </p>
      <input
        type="file"
        accept="application/pdf"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        className="text-sm"
      />
      {busy && <p className="mt-2 text-xs text-slate-500">{busy}</p>}
      {parsed && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            {parsed.notificationNumber} {parsed.notificationDate ? `dt. ${parsed.notificationDate}` : ''} — {parsed.summary}
          </p>
          {parsed.uncertainFields.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">⚠️ Model unsure about: {parsed.uncertainFields.join(', ')}</p>
          )}
          <table className="mt-2 w-full text-sm">
            <thead><tr><Th>CTH</Th><Th>Description</Th><Th>Serial</Th><Th>BCD %</Th><Th>IGST %</Th><Th>Exempt %</Th><Th>{''}</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {parsed.proposals.map((p, i) => (
                <tr key={i}>
                  <Td><span className="font-mono">{p.cth}</span></Td>
                  <Td>{p.description}</Td>
                  <Td>{p.serial ?? ''}</Td>
                  <Td>{p.bcdRate ?? '—'}</Td>
                  <Td>{p.igstRate ?? '—'}</Td>
                  <Td>{p.exemptionPercent ?? '—'}</Td>
                  <Td>
                    <button onClick={() => accept(p)} className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700">
                      Accept
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/* ---------------- Job memory ---------------- */

function MemoryTab({ rows, onChanged }: { rows: ProductMemory[]; onChanged: () => Promise<void> }) {
  async function remove(m: ProductMemory) {
    await fetch('/api/masters/product-memory', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importerKey: m.importerKey, descriptionKey: m.descriptionKey }),
    });
    await onChanged();
  }

  return (
    <Panel>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing learned yet. When a job is approved, importer + product → RITC/rate mappings are remembered here and
          auto-applied to future jobs.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead><tr><Th>Importer</Th><Th>Product</Th><Th>RITC</Th><Th>BCD/IGST</Th><Th>Learned from</Th><Th>{''}</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => (
              <tr key={`${m.importerKey}|${m.descriptionKey}`}>
                <Td>{m.importerKey}</Td>
                <Td>{m.descriptionKey}</Td>
                <Td><span className="font-mono">{m.ritc}</span></Td>
                <Td>{m.bcdRate}% / {m.igstRate}%</Td>
                <Td>{m.learnedFrom} ({m.learnedAt})</Td>
                <Td>
                  <button onClick={() => remove(m)} className="text-xs text-red-600 hover:underline">forget</button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
