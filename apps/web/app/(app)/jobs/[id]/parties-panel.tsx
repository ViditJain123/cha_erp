'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PartyMatchStatus } from '@checklist/extraction';
import { setJobParty } from './actions';
import { BUTTON, SMALL_FIELD } from './ui';

/** What the search route hands back for one repository row. */
interface Candidate {
  id: string;
  name: string;
  branchName: string;
  branchSrNo: string;
  city: string | null;
  country: string | null;
  iec: string | null;
  gstin: string | null;
  adCode: string | null;
}

export interface PartyState {
  slot: 'importer' | 'supplier';
  role: 'consignee' | 'shipper';
  label: string;
  name: string;
  branchName?: string;
  city?: string;
  iec?: string;
  gstin?: string;
  adCode?: string;
  status?: PartyMatchStatus;
}

const PILLS: Record<PartyMatchStatus, { text: string; className: string }> = {
  exact: { text: 'from repository', className: 'bg-emerald-100 text-emerald-800' },
  manual: { text: 'chosen', className: 'bg-emerald-100 text-emerald-800' },
  fuzzy: { text: 'matched by approximate name', className: 'bg-amber-100 text-amber-900' },
  ambiguous: { text: 'several branches match', className: 'bg-amber-100 text-amber-900' },
  none: { text: 'not in repository', className: 'bg-amber-100 text-amber-900' },
};

/**
 * The two parties Logi-Sys resolves from its own repository.
 *
 * Everything the workbook says about them is the repository's, so the only
 * thing that can go wrong here is being bound to the wrong row — or to none.
 * That is what this panel is for: it shows which row a party is on, and lets
 * someone put it on a different one.
 */
export function PartiesPanel({ jobId, parties }: { jobId: string; parties: PartyState[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Parties</h2>
      <p className="mb-4 text-xs text-slate-500">
        Logi-Sys looks these up in its own repository by name and branch, so the workbook has to
        carry the exact row &mdash; not the name the shipping documents printed.
      </p>
      <div className="space-y-4">
        {parties.map((party) => (
          <Party key={party.slot} jobId={jobId} party={party} />
        ))}
      </div>
    </section>
  );
}

function Party({ jobId, party }: { jobId: string; party: PartyState }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const pill = party.status ? PILLS[party.status] : undefined;
  const detail = [
    party.branchName && `branch ${party.branchName}`,
    party.city,
    party.iec && `IEC ${party.iec}`,
    party.gstin && `GSTIN ${party.gstin}`,
    party.adCode && `AD ${party.adCode}`,
  ]
    .filter(Boolean)
    .join(' · ');

  function choose(candidate: Candidate) {
    setError(null);
    startSaving(async () => {
      const result = await setJobParty(jobId, party.slot, candidate.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">{party.label}</span>
        {pill && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pill.className}`}>
            {pill.text}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm font-medium">{party.name || '—'}</div>
      {detail && <div className="text-xs text-slate-500">{detail}</div>}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`mt-2 ${BUTTON}`}
        disabled={saving}
      >
        {open ? 'Cancel' : saving ? 'Saving…' : 'Choose from repository'}
      </button>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {open && <Picker role={party.role} initialQuery={party.name} onChoose={choose} />}
    </div>
  );
}

/**
 * A search box over the repository.
 *
 * A plain input and a list of buttons rather than a combobox: there is no
 * component library here, and five thousand parties rules out a `<select>` or
 * a `<datalist>` — neither of which could show the branch and IEC that tell
 * two rows of the same name apart anyway.
 */
function Picker({
  role,
  initialQuery,
  onChoose,
}: {
  role: 'consignee' | 'shipper';
  initialQuery: string;
  onChoose: (candidate: Candidate) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    // Debounced: the operator types until they recognise the branch, and every
    // keystroke would otherwise be a trigram scan over the whole master.
    const timer = setTimeout(async () => {
      const token = ++latest.current;
      setBusy(true);
      try {
        const res = await fetch(
          `/api/organizations/search?role=${role}&q=${encodeURIComponent(query)}`,
        );
        const body = (await res.json()) as { results?: Candidate[] };
        // A slower earlier request must not overwrite a faster later one.
        if (token === latest.current) setResults(body.results ?? []);
      } finally {
        if (token === latest.current) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, role]);

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        type="search"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the organization repository"
        className={`w-full ${SMALL_FIELD}`}
      />
      {busy && <p className="mt-2 text-xs text-slate-400">Searching…</p>}
      {!busy && results.length === 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Nothing matches. Add the party in Logi-Sys, then re-upload the repository under Settings
          &rarr; Organizations.
        </p>
      )}
      <ul className="mt-2 max-h-64 divide-y divide-slate-200 overflow-y-auto">
        {results.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              onClick={() => onChoose(candidate)}
              className="w-full px-1 py-2 text-left hover:bg-white"
            >
              <div className="text-sm font-medium">{candidate.name}</div>
              <div className="text-xs text-slate-500">
                {[
                  candidate.branchName && `branch ${candidate.branchName}`,
                  candidate.city,
                  candidate.country,
                  candidate.iec && `IEC ${candidate.iec}`,
                  candidate.adCode && `AD ${candidate.adCode}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
