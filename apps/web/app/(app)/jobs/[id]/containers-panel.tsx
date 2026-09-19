'use client';

import { useActionState, useState } from 'react';
import { saveContainers } from './actions';
import { BUTTON, Note, PRIMARY, SMALL_FIELD } from './ui';

/**
 * The container list — the CONTAINERS sheet — as a form.
 *
 * Every job we had exported carried one container row, whatever the bill of
 * lading said: `liv_job1` moves four boxes, `ex_job6` moves six. Most of that is
 * fixed by reading the B/L properly, but not all of it can be — `ex_job4`'s B/L
 * is a scan with no text in it at all, and the only way that job's container
 * reaches Customs is a person typing it.
 *
 * So the panel does two things. It shows the count the B/L states beside the
 * count the Bill of Entry would declare, because a disagreement between those
 * two numbers is the whole failure and it is otherwise invisible. And it lets
 * the list be corrected, in which case the typed list is the list — saved
 * separately from the draft, so reading the documents again does not undo it.
 */

export interface ContainerEntry {
  containerNo: string;
  sealNo: string;
  sizeType: string;
}

export interface ContainersState {
  jobId: string;
  /** What the Bill of Entry would declare today. */
  containers: ContainerEntry[];
  /** How many the bill of lading says there are, when it says. */
  statedCount?: number;
  /** Whether the rows above came from `job_containers` rather than the documents. */
  fromOperator: boolean;
}

const EMPTY_ROW: ContainerEntry = { containerNo: '', sealNo: '', sizeType: '' };

export function ContainersPanel({ jobId, containers, statedCount, fromOperator }: ContainersState) {
  const [state, action, pending] = useActionState(saveContainers, {});
  const [rows, setRows] = useState<ContainerEntry[]>(
    containers.length ? containers : [EMPTY_ROW],
  );

  const filled = rows.filter((r) => r.containerNo.trim() !== '');
  const mismatch = statedCount !== undefined && statedCount !== filled.length;

  function set(i: number, field: keyof ContainerEntry, value: string) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">Containers</h2>
        <span className="text-xs text-slate-500">
          {filled.length} on the Bill of Entry
          {statedCount !== undefined && ` · B/L states ${statedCount}`}
        </span>
        <span
          className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${
            fromOperator ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {fromOperator ? 'keyed here' : 'from the documents'}
        </span>
      </div>

      <div className="px-5 py-4">
        {mismatch && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            The bill of lading states {statedCount} container{statedCount === 1 ? '' : 's'} and this
            list has {filled.length}. A Bill of Entry that declares some of the containers is a
            wrong one, not a short one — check the list against the B/L before filing.
          </div>
        )}

        <form action={action} className="space-y-2">
          <input type="hidden" name="jobId" value={jobId} />

          <div className="grid grid-cols-[1.4fr_1.2fr_0.9fr_auto] gap-2 text-[11px] font-medium text-slate-500">
            <span>Container no</span>
            <span>Seal no</span>
            <span>Size / type</span>
            <span className="w-6" />
          </div>

          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[1.4fr_1.2fr_0.9fr_auto] items-center gap-2">
              <input
                name="containerNo"
                value={row.containerNo}
                onChange={(e) => set(i, 'containerNo', e.target.value)}
                placeholder="CAIU3686895"
                className={`${SMALL_FIELD} font-mono uppercase`}
              />
              <input
                name="sealNo"
                value={row.sealNo}
                onChange={(e) => set(i, 'sealNo', e.target.value)}
                placeholder="QIN2410658"
                className={`${SMALL_FIELD} font-mono`}
              />
              <input
                name="sizeType"
                value={row.sizeType}
                onChange={(e) => set(i, 'sizeType', e.target.value)}
                // Verbatim, as the B/L prints it. ContainerSize and
                // ContainerTypeCode are derived from this on export.
                placeholder="20GP"
                className={SMALL_FIELD}
              />
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="w-6 text-xs text-slate-400 hover:text-red-600"
                aria-label={`Remove ${row.containerNo || 'this row'}`}
              >
                ×
              </button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, EMPTY_ROW])}
              className={BUTTON}
            >
              Add a container
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? 'Saving…' : 'Save container list'}
            </button>
          </div>

          <p className="pt-1 text-[11px] text-slate-500">
            Saving keeps this list through a re-read of the documents. Save it empty to hand the
            sheet back to whatever the documents say.
          </p>
        </form>

        <Note state={state} />
      </div>
    </section>
  );
}
