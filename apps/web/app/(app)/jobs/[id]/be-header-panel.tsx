'use client';

import { useActionState } from 'react';
import type { BoeHeader } from '@checklist/extraction';
import { saveBeHeader } from './actions';
import { FIELD, LABEL, Note, PRIMARY, type ActionNote } from './ui';

/**
 * The Bill of Entry header — the GENERAL sheet — as a form.
 *
 * This panel exists because thirteen of that sheet's twenty-three columns state
 * things no shipping document says: which custom house to file at, whether the
 * goods are warehoused, whether an IGM has been filed yet. They used to be
 * constants in code, which meant a Bill of Entry could assert a filing posture
 * nobody had checked.
 *
 * So every field here shows *where its value came from* — the customer's mail
 * with the sentence it was read from, the importer master, or a person. A field
 * marked "default" is one nobody has confirmed, and it is the operator's job to
 * look at exactly those.
 */

export interface BeHeaderState {
  jobId: string;
  header: BoeHeader | null;
  /** Current stored operator entries, so the form round-trips. */
  entries: {
    igmNo: string;
    igmDate: string;
    inwardDate: string;
    lineNo: string;
    gatewayIgmNo: string;
    gatewayIgmDate: string;
    gatewayInwardDate: string;
    packageUnitCode: string;
    marksAndNos: string;
    beFilingDate: string;
    igmChecked: boolean;
    customsHouseCode: string;
    beType: string;
    dutyPaymentStatus: string;
    adCode: string;
    importerRefNo: string;
    flags: Record<string, boolean>;
    sec46OverrideReason: string;
  };
}

const SOURCE_PILL: Record<string, { text: string; className: string }> = {
  operator: { text: 'set here', className: 'bg-emerald-100 text-emerald-800' },
  mail: { text: 'from the mail', className: 'bg-indigo-100 text-indigo-800' },
  master: { text: 'from the master', className: 'bg-slate-100 text-slate-700' },
  document: { text: 'from the documents', className: 'bg-slate-100 text-slate-700' },
  default: { text: 'default — unconfirmed', className: 'bg-amber-100 text-amber-900' },
};

function Provenance({
  source,
  because,
  quote,
}: {
  source?: string;
  because?: string;
  quote?: string;
}) {
  if (!source) {
    return (
      <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-800">
        not decided
      </span>
    );
  }
  const pill = SOURCE_PILL[source] ?? SOURCE_PILL.default!;
  return (
    <>
      <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${pill.className}`}>
        {pill.text}
      </span>
      {because && <span className="ml-1.5 text-[11px] text-slate-500">{because}</span>}
      {quote && (
        <blockquote className="mt-1 border-l-2 border-indigo-200 pl-2 text-[11px] italic text-slate-500">
          “{quote.trim()}”
        </blockquote>
      )}
    </>
  );
}

const FLAGS: { key: string; name: string; label: string }[] = [
  { key: 'firstCheck', name: 'isFirstCheck', label: 'First check' },
  { key: 'greenChannel', name: 'isGreenChannel', label: 'Green channel' },
  { key: 'kachchaBe', name: 'isKachchaBe', label: 'Kachcha BE' },
  { key: 'hss', name: 'isHss', label: 'High seas sale' },
  { key: 'bondsCertificates', name: 'isBondsCertificates', label: 'Bonds / certificates' },
  { key: 'transhipment', name: 'isTranshipment', label: 'Transhipment' },
  { key: 'itcLicDetails', name: 'itcLicDetails', label: 'ITC licence details' },
  {
    key: 'provisionalAssessment',
    name: 'isUnderProvisionalAssessment',
    label: 'Provisional assessment',
  },
];

export function BeHeaderPanel({ jobId, header, entries }: BeHeaderState) {
  const [state, action, pending] = useActionState<ActionNote, FormData>(saveBeHeader, {});

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Bill of Entry header</h2>
      <p className="mb-4 text-xs text-slate-500">
        The GENERAL sheet. None of this is on the shipping documents &mdash; it is what the customer
        instructed, what we hold about the importer, and what you decide.
      </p>

      <form action={action} className="space-y-4">
        <input type="hidden" name="jobId" value={jobId} />

        <dl className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
          <Row label="Transport mode" value={header?.transportMode.value} r={header?.transportMode} />
          <Row
            label="Custom house"
            value={
              header?.customStation
                ? `${header.customStation.value.name} (${header.customStation.value.code})`
                : undefined
            }
            r={header?.customStation}
          />
          <Row label="BE type" value={header?.beType.value} r={header?.beType} />
          <Row
            label="Duty payment"
            value={header?.dutyPaymentStatus.value === 'D' ? 'Deferred' : 'Transaction'}
            r={header?.dutyPaymentStatus}
          />
          <Row label="Filing status" value={header?.filingStatus?.value} r={header?.filingStatus} />
          <Row label="AD code" value={header?.adCode?.value} r={header?.adCode} />
          <Row
            label="Importer ref"
            value={header?.importerRefNo?.value ?? '—'}
            r={header?.importerRefNo}
          />
        </dl>

        {/* The IGM block. Advance/Prior/Normal and both section flags are
            functions of these four values and nothing else. */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">
            IGM &amp; dates &mdash; from ICEGATE or the shipping line
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="igmNo">
                IGM number
              </label>
              <input className={FIELD} id="igmNo" name="igmNo" defaultValue={entries.igmNo} />
            </div>
            <div>
              <label className={LABEL} htmlFor="igmDate">
                IGM date
              </label>
              <input
                className={FIELD}
                id="igmDate"
                name="igmDate"
                type="date"
                defaultValue={entries.igmDate}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="inwardDate">
                Entry inwards date
              </label>
              <input
                className={FIELD}
                id="inwardDate"
                name="inwardDate"
                type="date"
                defaultValue={entries.inwardDate}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="beFilingDate">
                BE filing date
              </label>
              <input
                className={FIELD}
                id="beFilingDate"
                name="beFilingDate"
                type="date"
                defaultValue={entries.beFilingDate}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="lineNo">
                IGM line no
              </label>
              <input className={FIELD} id="lineNo" name="lineNo" defaultValue={entries.lineNo} />
            </div>
          </div>
          <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              name="igmChecked"
              defaultChecked={entries.igmChecked}
              className="mt-0.5"
            />
            <span>
              I checked ICEGATE for an IGM against this BL.
              <span className="block text-slate-400">
                Without this, no IGM number means &ldquo;nobody looked&rdquo; rather than
                &ldquo;Advance filing&rdquo;, and the filing status stays blank.
              </span>
            </span>
          </label>
        </fieldset>

        {/* The gateway manifest. A consignment cleared at an ICD was manifested
            at a sea port first, and the BE carries both. Rendered on every job
            rather than hidden on direct-port ones: a job we classified as a sea
            filing when it is really an ICD one is exactly the job where an
            operator needs to be able to fill these. */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">
            Gateway IGM &mdash; inland (ICD) clearances only
          </legend>
          <p className="mb-2 text-xs text-slate-400">
            When the BE is filed at an ICD, the IGM above is the ICD&rsquo;s. The sea port the
            vessel actually arrived at files its own manifest, and that one goes here.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL} htmlFor="gatewayIgmNo">
                Gateway IGM no
              </label>
              <input
                className={FIELD}
                id="gatewayIgmNo"
                name="gatewayIgmNo"
                defaultValue={entries.gatewayIgmNo}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="gatewayIgmDate">
                Gateway IGM date
              </label>
              <input
                className={FIELD}
                id="gatewayIgmDate"
                name="gatewayIgmDate"
                type="date"
                defaultValue={entries.gatewayIgmDate}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="gatewayInwardDate">
                Gateway inward date
              </label>
              <input
                className={FIELD}
                id="gatewayInwardDate"
                name="gatewayInwardDate"
                type="date"
                defaultValue={entries.gatewayInwardDate}
              />
            </div>
          </div>
        </fieldset>

        {/* Two SHIPMENT cells no document states. Both are left empty unless a
            person fills them, and both warn on export when they are. */}
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Shipment</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="packageUnitCode">
                Package kind
              </label>
              <input
                className={FIELD}
                id="packageUnitCode"
                name="packageUnitCode"
                placeholder="as read from the documents"
                defaultValue={entries.packageUnitCode}
              />
              <span className="mt-1 block text-xs text-slate-400">
                BAG, CTN, PLT, DRUM&hellip; An air waybill counts pieces without naming them, so
                on an air job this is usually the only source.
              </span>
            </div>
            <div>
              <label className={LABEL} htmlFor="marksAndNos">
                Marks &amp; numbers
              </label>
              <textarea
                className={FIELD}
                id="marksAndNos"
                name="marksAndNos"
                rows={3}
                placeholder="AS PER BL"
                defaultValue={entries.marksAndNos}
              />
              <span className="mt-1 block text-xs text-slate-400">
                Leave empty for the usual &ldquo;AS PER BL&rdquo;. A re-import or free-of-cost
                consignment declares itself here instead.
              </span>
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Overrides</legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL} htmlFor="customsHouseCode">
                Custom house code
              </label>
              <input
                className={FIELD}
                id="customsHouseCode"
                name="customsHouseCode"
                placeholder="INNSA1"
                defaultValue={entries.customsHouseCode}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="beType">
                BE type
              </label>
              <select className={FIELD} id="beType" name="beType" defaultValue={entries.beType}>
                <option value="">as instructed</option>
                <option value="home_consumption">Home consumption (H)</option>
                <option value="warehousing">Warehousing / in-bond (W)</option>
                <option value="ex_bond">Ex-bond (EX)</option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="dutyPaymentStatus">
                Duty payment
              </label>
              <select
                className={FIELD}
                id="dutyPaymentStatus"
                name="dutyPaymentStatus"
                defaultValue={entries.dutyPaymentStatus}
              >
                <option value="">as resolved</option>
                <option value="T">Transaction (T)</option>
                <option value="D">Deferred (D)</option>
              </select>
            </div>
            <div>
              <label className={LABEL} htmlFor="adCode">
                AD code
              </label>
              {header?.adCodeChoices?.length ? (
                <select className={FIELD} id="adCode" name="adCode" defaultValue={entries.adCode}>
                  <option value="">choose &mdash; the importer has several</option>
                  {header.adCodeChoices.map((c) => (
                    <option key={c.adCode} value={c.adCode}>
                      {c.adCode}
                      {c.bankName ? ` — ${c.bankName}` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={FIELD}
                  id="adCode"
                  name="adCode"
                  defaultValue={entries.adCode}
                  placeholder="from the importer"
                />
              )}
            </div>
            <div className="col-span-2">
              <label className={LABEL} htmlFor="importerRefNo">
                Importer&rsquo;s reference
              </label>
              <input
                className={FIELD}
                id="importerRefNo"
                name="importerRefNo"
                defaultValue={entries.importerRefNo}
                placeholder="their PO or indent number"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">
            Declarations &mdash; ticked writes Y, unticked writes nothing
          </legend>
          <div className="grid grid-cols-2 gap-y-1.5">
            {FLAGS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" name={f.name} defaultChecked={entries.flags[f.key]} />
                {f.label}
              </label>
            ))}
          </div>

          {/* Sections 46 and 48 are derived, not ticked — but the derivation
              does not know about customs holidays, so it can be cleared. */}
          <div className="mt-3 border-t border-slate-100 pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-600">
                Section 46 (late presentation)
                {header?.flags.underSec46 === undefined
                  ? ' — needs the inward and filing dates'
                  : header.flags.underSec46
                    ? ' — flagged Y'
                    : ' — not late'}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-slate-600">
                Section 48 (cleared after 30 days)
                {header?.flags.underSec48 === undefined
                  ? ' — needs the inward and filing dates'
                  : header.flags.underSec48
                    ? ' — flagged Y'
                    : ' — within 30 days'}
              </span>
            </div>
            {header?.flags.underSec46 && (
              <div className="mt-2">
                <label className={LABEL} htmlFor="sec46OverrideReason">
                  Clear the Section 46 flag (holidays, waiver granted) &mdash; give the reason
                </label>
                <input
                  className={FIELD}
                  id="sec46OverrideReason"
                  name="sec46OverrideReason"
                  defaultValue={entries.sec46OverrideReason}
                  placeholder="leave empty to keep the flag"
                />
              </div>
            )}
          </div>
        </fieldset>

        <button className={PRIMARY} disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Save header'}
        </button>
        <Note state={state} />
      </form>
    </section>
  );
}

function Row({
  label,
  value,
  r,
}: {
  label: string;
  value: string | undefined;
  r?: { source: string; because?: string; quote?: string };
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline">
        <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
        <dd className="font-medium text-slate-900">{value ?? '—'}</dd>
        <Provenance source={r?.source} because={r?.because} quote={r?.quote} />
      </div>
    </div>
  );
}
