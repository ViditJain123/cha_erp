'use client';

import { useState } from 'react';
import type { LibraryDocMeta, SearchHit } from '@checklist/library';

export default function LibraryView({ initialDocs }: { initialDocs: LibraryDocMeta[] }) {
  const [docs, setDocs] = useState(initialDocs);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [ingest, setIngest] = useState({ url: '', label: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const indexed = docs.filter((d) => d.indexedAt).length;

  async function search() {
    setBusy('Searching…');
    const res = await fetch('/api/library/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    setHits(((await res.json()) as { hits: SearchHit[] }).hits);
  }

  async function ingestNotification() {
    setBusy('Downloading & indexing…');
    const res = await fetch('/api/library/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ingest),
    });
    setBusy(null);
    if (!res.ok) return alert(await res.text());
    setIngest({ url: '', label: '' });
    setDocs(((await (await fetch('/api/library')).json()) as { docs: LibraryDocMeta[] }).docs);
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Official Document Library</h1>
      <p className="mb-5 text-sm text-slate-500">
        Government-published tariff schedules and notifications, indexed for retrieval. {docs.length} documents,{' '}
        {indexed} indexed. Proposals made from these documents always cite their source page.
      </p>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && query.trim() && search()}
            placeholder='Ask the library, e.g. "tariff rate for lactose" or "DFTP least developed countries exemption"'
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={search}
            disabled={!query.trim() || !!busy}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ?? 'Search'}
          </button>
        </div>
        {hits && (
          <div className="mt-3 space-y-2">
            {hits.length === 0 && <p className="text-sm text-slate-500">No matches.</p>}
            {hits.map((h, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{h.title} · p.{h.page}</span>
                  <a className="text-indigo-600 hover:underline" href={h.sourceUrl} target="_blank">source ↗</a>
                </div>
                <p className="text-slate-600">{h.text.slice(0, 400)}…</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">Add a notification</h2>
        <p className="mb-2 text-xs text-slate-500">
          Paste a PDF link from taxinformation.cbic.gov.in (stable “view-pdf” URLs) — it is downloaded, stored with
          provenance and indexed.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={ingest.url}
            onChange={(e) => setIngest({ ...ingest, url: e.target.value })}
            placeholder="https://taxinformation.cbic.gov.in/view-pdf/…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={ingest.label}
            onChange={(e) => setIngest({ ...ingest, label: e.target.value })}
            placeholder="Label e.g. 096/2008-Customs"
            className="w-56 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            onClick={ingestNotification}
            disabled={!ingest.url || !ingest.label || !!busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {busy ?? 'Ingest'}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Document</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Pages</th>
              <th className="px-4 py-2">Indexed</th>
              <th className="px-4 py-2">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2">{d.title}</td>
                <td className="px-4 py-2 text-slate-500">{d.kind}</td>
                <td className="px-4 py-2">{d.pages ?? '—'}</td>
                <td className="px-4 py-2">{d.indexedAt ? '✅' : '—'}</td>
                <td className="px-4 py-2">
                  <a className="text-xs text-indigo-600 hover:underline" href={d.sourceUrl} target="_blank">link ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
