'use client';

import { useActionState, useState } from 'react';
import { saveSecurities } from './actions';
import { BUTTON, FIELD, LABEL, Note, PRIMARY, SMALL_FIELD, type ActionNote } from './ui';

/**
 * The high-seas chain and the securities — the HSS and BONDS_CERTIFICATES
 * sheets.
 *
 * Both are here rather than on the bond panel because neither is about a
 * warehouse: `ex_job25`, `ex_job26` and `ex_job31` all lodge a bond or a
 * certificate on a plain home-consumption filing, and a high-seas sale has
 * nothing to do with warehousing at all.
 *
 * **Not the same "securities" as `/settings/securities`.** That page holds
 * `importer_line_securities` — a container deposit an importer has lodged with
 * a *shipping line*, for delivery orders. These are bonds executed with
 * *Customs*, and the two never meet.
 *
 * What this panel exists to get right:
 *
 *   - **The preceding level is positional.** ICES counts backwards from the
 *     importer filing the BE, who is declared on GENERAL and never on the HSS
 *     sheet. So the operator orders the rows and the level is derived; typing
 *     it would let one wrong number misstate the whole chain.
 *   - **A bond and a certificate are different shapes.** A bond carries a
 *     registration port and no date; a certificate a date and no port. Showing
 *     both sets of fields on every row is how the wrong one gets filled.
 *   - **Bond state is invisible to us.** ICES rejects a bond that is expired,
 *     closed or uncredited and nothing here can see that, which is why no bond
 *     number is ever carried over from a previous job unconfirmed.
 *
 * Contracts: docs/boe-mapping/16-hss.md, 17-bonds-certificates.md.
 */

export interface HssPartyEntry {
  iec: string;
  branchSrNo: string;
  name: string;
  branchName: string;
  adCode: string;
  address: string;
  city: string;
  country: string;
  postalCode: string;
}

export interface SecurityEntry {
  kind: 'bond' | 'certificate';
  type: string;
  number: string;
  date: string;
  commissionerate: string;
  division: string;
  range: string;
  registrationPort: string;
  /** True when the code came from a licence or the warehouse rather than a person. */
  proposed?: boolean;
}

export interface SecuritiesPanelState {
  jobId: string;
  /** `GENERAL.IsHSS`. The chain is only declared when this is ticked. */
  isHss: boolean;
  chain: HssPartyEntry[];
  securities: SecurityEntry[];
  /** The bond codes and certificate types, for the two dropdowns. */
  bondCodes: { code: string; label: string }[];
  certificateTypes: { code: string; label: string }[];
}

const EMPTY_PARTY: HssPartyEntry = {
  iec: '',
  branchSrNo: '',
  name: '',
  branchName: '',
  adCode: '',
  address: '',
  city: '',
  country: '',
  postalCode: '',
};

const EMPTY_SECURITY: SecurityEntry = {
  kind: 'bond',
  type: '',
  number: '',
  date: '',
  commissionerate: '',
  division: '',
  range: '',
  registrationPort: '',
};

/**
 * The IE Codes DGFT issues to importers exempt from holding one of their own.
 * For one of these, ICES cannot fill the party from its directory and the name
 * and address become mandatory (error 164) — so the panel says so before the
 * export refuses.
 */
const EXEMPTED_IECS = new Set([
  '0100000011', '0100000029', '0100000037', '0100000045', '0100000053', '0100000061',
  '0100000070', '0100000088', '0100000096', '0100000100', '0100000126', '0100000001',
]);

export function SecuritiesPanel({
  jobId,
  isHss,
  chain,
  securities,
  bondCodes,
  certificateTypes,
}: SecuritiesPanelState) {
  const [state, action, pending] = useActionState<ActionNote, FormData>(saveSecurities, {});
  const [parties, setParties] = useState<HssPartyEntry[]>(chain);
  const [rows, setRows] = useState<SecurityEntry[]>(securities);

  const setParty = (i: number, patch: Partial<HssPartyEntry>) =>
    setParties((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setRow = (i: number, patch: Partial<SecurityEntry>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">High seas sale, bonds and certificates</h2>
      <p className="mb-4 text-xs text-slate-500">
        Who owned the goods before this importer did, and what security Customs already holds
        against the filing. Neither is on a shipping document.
      </p>

      <form action={action} className="space-y-6">
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="hssCount" value={parties.length} />
        <input type="hidden" name="bondCount" value={rows.length} />

        {/* ------------------------------------------------------ HSS ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">The chain of sales afloat</h3>
            <button
              type="button"
              className={BUTTON}
              onClick={() => setParties((list) => [...list, { ...EMPTY_PARTY }])}
            >
              Add a seller
            </button>
          </div>

          {!isHss && parties.length > 0 && (
            <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              The job is not flagged as a high seas sale, so nothing here is declared. Tick the
              high-seas-sale box on the Bill of Entry header first.
            </p>
          )}

          {parties.length === 0 ? (
            <p className="text-xs text-slate-400">
              No sale afloat. The sheet stays empty, which is right for an ordinary import.
            </p>
          ) : (
            <p className="mb-2 text-[11px] text-slate-500">
              First row is the party who sold to <strong>this</strong> importer; the one below it is
              that party&rsquo;s seller. The importer filing the BE is on the header and is never
              listed here.
            </p>
          )}

          <div className="space-y-3">
            {parties.map((party, i) => {
              const exempted = EXEMPTED_IECS.has(party.iec.trim());
              return (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-600">
                      Preceding level {i}
                      {i === 0 && ' — sold to this importer'}
                    </span>
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => setParties((list) => list.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="col-span-2">
                      <span className={LABEL}>IE Code</span>
                      <input
                        name={`hss_${i}_iec`}
                        value={party.iec}
                        onChange={(e) => setParty(i, { iec: e.target.value })}
                        className={FIELD}
                        placeholder="ten characters"
                      />
                    </label>
                    <label>
                      <span className={LABEL}>Branch serial</span>
                      <input
                        name={`hss_${i}_branchSrNo`}
                        value={party.branchSrNo}
                        onChange={(e) => setParty(i, { branchSrNo: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label>
                      <span className={LABEL}>AD code</span>
                      <input
                        name={`hss_${i}_adCode`}
                        value={party.adCode}
                        onChange={(e) => setParty(i, { adCode: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label className="col-span-2">
                      <span className={LABEL}>
                        Name{exempted && <span className="text-red-600"> — required</span>}
                      </span>
                      <input
                        name={`hss_${i}_name`}
                        value={party.name}
                        onChange={(e) => setParty(i, { name: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label className="col-span-2">
                      <span className={LABEL}>Branch name</span>
                      <input
                        name={`hss_${i}_branchName`}
                        value={party.branchName}
                        onChange={(e) => setParty(i, { branchName: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label className="col-span-2 sm:col-span-4">
                      <span className={LABEL}>
                        Address{exempted && <span className="text-red-600"> — required</span>}
                      </span>
                      <input
                        name={`hss_${i}_address`}
                        value={party.address}
                        onChange={(e) => setParty(i, { address: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label>
                      <span className={LABEL}>City</span>
                      <input
                        name={`hss_${i}_city`}
                        value={party.city}
                        onChange={(e) => setParty(i, { city: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label>
                      <span className={LABEL}>Country</span>
                      <input
                        name={`hss_${i}_country`}
                        value={party.country}
                        onChange={(e) => setParty(i, { country: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                    <label>
                      <span className={LABEL}>Postal code</span>
                      <input
                        name={`hss_${i}_postalCode`}
                        value={party.postalCode}
                        onChange={(e) => setParty(i, { postalCode: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                  </div>

                  {exempted ? (
                    <p className="mt-2 text-[11px] text-amber-800">
                      This is an exempted-category IE Code, so ICES cannot look the party up — the
                      name, address, city and pin all have to be declared.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      ICES fills the name and address from its own IEC directory, so they are
                      optional here. The branch serial is not: an unregistered one is a rejection.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ------------------------------------- bonds and certificates ---- */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700">Bonds and certificates</h3>
            <button
              type="button"
              className={BUTTON}
              onClick={() => setRows((list) => [...list, { ...EMPTY_SECURITY }])}
            >
              Add a security
            </button>
          </div>

          {rows.length === 0 && (
            <p className="text-xs text-slate-400">
              Nothing lodged. The sheet stays empty, and the header&rsquo;s
              &ldquo;bonds/certificates&rdquo; flag stays blank with it.
            </p>
          )}

          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <select
                    name={`bond_${i}_kind`}
                    value={row.kind}
                    onChange={(e) =>
                      setRow(i, { kind: e.target.value as SecurityEntry['kind'], type: '' })
                    }
                    className={SMALL_FIELD}
                  >
                    <option value="bond">Bond</option>
                    <option value="certificate">Certificate</option>
                  </select>
                  {row.proposed && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                      proposed — confirm it
                    </span>
                  )}
                  <button
                    type="button"
                    className={`${BUTTON} ml-auto`}
                    onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label>
                    <span className={LABEL}>Type</span>
                    <select
                      name={`bond_${i}_type`}
                      value={row.type}
                      onChange={(e) => setRow(i, { type: e.target.value })}
                      className={FIELD}
                    >
                      <option value="">—</option>
                      {(row.kind === 'bond' ? bondCodes : certificateTypes).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} — {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2">
                    <span className={LABEL}>
                      {row.kind === 'bond' ? 'Bond number' : 'Certificate number'}
                    </span>
                    <input
                      name={`bond_${i}_number`}
                      value={row.number}
                      onChange={(e) => setRow(i, { number: e.target.value })}
                      className={FIELD}
                      placeholder={row.kind === 'bond' ? 'up to ten digits' : ''}
                    />
                  </label>

                  {row.kind === 'bond' ? (
                    <label>
                      <span className={LABEL}>Registered at</span>
                      <input
                        name={`bond_${i}_registrationPort`}
                        value={row.registrationPort}
                        onChange={(e) => setRow(i, { registrationPort: e.target.value })}
                        className={FIELD}
                        placeholder="ICES code"
                      />
                    </label>
                  ) : (
                    <label>
                      <span className={LABEL}>Date</span>
                      <input
                        type="date"
                        name={`bond_${i}_date`}
                        value={row.date}
                        onChange={(e) => setRow(i, { date: e.target.value })}
                        className={FIELD}
                      />
                    </label>
                  )}
                </div>

                {/* The Central Excise jurisdiction, only for a certificate
                    produced in lieu of a bond on an EOU or job-work filing. */}
                {row.kind === 'certificate' && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['commissionerate', 'division', 'range'] as const).map((field) => (
                      <label key={field}>
                        <span className={LABEL}>
                          {field === 'range'
                            ? 'Range'
                            : field[0]!.toUpperCase() + field.slice(1)}
                        </span>
                        <input
                          name={`bond_${i}_${field}`}
                          value={row[field]}
                          onChange={(e) => setRow(i, { [field]: e.target.value })}
                          className={FIELD}
                        />
                      </label>
                    ))}
                  </div>
                )}

                {row.kind === 'bond' && row.type === 'EI' && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    An IGCR claim needs the IIN as well: add a <strong>certificate</strong> row of
                    type EI with the number from Form IGCR-1.
                  </p>
                )}
              </div>
            ))}
          </div>

          {rows.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-500">
              Customs checks each bond is live, credited and not yet closed. Nothing here can see
              that, so confirm a bond carried over from an earlier job before exporting.
            </p>
          )}
        </div>

        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </form>

      <Note state={state} />
    </section>
  );
}
