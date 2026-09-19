'use client';

import { useActionState, useState } from 'react';
import type { ExBondClearanceKind, InbondExbond } from '@checklist/extraction';
import { saveBondDetails } from './actions';
import { FIELD, LABEL, Note, PRIMARY, type ActionNote } from './ui';

/**
 * The warehousing block — the INBOND_EXBOND sheet.
 *
 * Shown only for a `W` or `EX` Bill of Entry, because for a home-consumption
 * filing there is no warehouse and the sheet stays empty.
 *
 * The two things this panel exists to get right are the two that Customs
 * refuses on. A warehouse code that is not a real code, and an ex-bond release
 * larger than the ledger holds, are both rejections rather than corrections —
 * so the code is shown decoded (which station licensed it, under which section)
 * and the release is shown with the arithmetic that produced it.
 */

export interface BondPanelState {
  jobId: string;
  beType: 'Warehousing' | 'Ex-Bond';
  block: InbondExbond | null;
  /** Per-item packing, so the operator can see what a package weighs. */
  packing: {
    slNo: number;
    description: string;
    packages: number;
    packageType?: string;
    perPackageGrossKg?: number;
  }[];
  entries: {
    warehouseCode: string;
    inbondBeNo: string;
    inbondBeDate: string;
    bondNo: string;
    bondDate: string;
    bondExpiryDate: string;
    isWarehouseSale: boolean;
    isSec65ManufacturingWh: boolean;
    exbondClearanceKind: ExBondClearanceKind | '';
    releasedPackages: string;
    releasedPackageCode: string;
    releasedGrossWeightKg: string;
    releasedUom: string;
  };
  /** The finished goods already recorded, in declaration order. */
  finishedGoods: FinishedGoodEntry[];
  /** The item serials on this BE, so an entry can be pinned to some of them. */
  itemSrNos: number[];
}

export interface FinishedGoodEntry {
  gstInvoiceNo: string;
  gstInvoiceDate: string;
  cth: string;
  description: string;
  quantity: string;
  uqc: string;
  /** Empty means every item on the BE, which is the ordinary case. */
  itemSrNos: string;
}

/**
 * What an ex-bond filing out of a section 65 warehouse is actually clearing.
 *
 * Only the first carries a SEC65_EXBOND_INFO declaration. The others are
 * clearances Circular 48/2020 allows out of the same warehouse without any
 * manufacture having happened, and they attract section 61 interest instead.
 */
const CLEARANCE_KINDS: { value: ExBondClearanceKind; label: string; hint: string }[] = [
  {
    value: 'resultant_product',
    label: 'A product manufactured in the warehouse',
    hint: 'Sold under a GST invoice. Duty falls on the imported inputs inside it; no interest.',
  },
  {
    value: 'as_such',
    label: 'The warehoused goods as such',
    hint: 'No manufacture happened. Duty plus interest under section 61.',
  },
  {
    value: 'capital_goods',
    label: 'Capital goods leaving the premises',
    hint: 'The duty event is the removal of the asset, not a sale of output.',
  },
  {
    value: 'job_work_return',
    label: 'Inputs consumed in job work',
    hint: 'Duty-paid when the job-worked goods go back to the principal.',
  },
];

/** A blank entry, for the "add" button. */
const EMPTY_FINISHED_GOOD: FinishedGoodEntry = {
  gstInvoiceNo: '',
  gstInvoiceDate: '',
  cth: '',
  description: '',
  quantity: '',
  uqc: '',
  itemSrNos: '',
};

const SOURCE_PILL: Record<string, { text: string; className: string }> = {
  operator: { text: 'set here', className: 'bg-emerald-100 text-emerald-800' },
  mail: { text: 'from the mail', className: 'bg-indigo-100 text-indigo-800' },
  master: { text: 'from the master', className: 'bg-slate-100 text-slate-700' },
  document: { text: 'from a document', className: 'bg-slate-100 text-slate-700' },
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
      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
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
    <div className="flex flex-wrap items-baseline">
      <dt className="w-28 shrink-0 text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value ?? '—'}</dd>
      <Provenance source={r?.source} because={r?.because} quote={r?.quote} />
    </div>
  );
}

export function BondPanel({
  jobId,
  beType,
  block,
  packing,
  entries,
  finishedGoods,
  itemSrNos,
}: BondPanelState) {
  const [state, action, pending] = useActionState<ActionNote, FormData>(saveBondDetails, {});
  const isExBond = beType === 'Ex-Bond';
  const wh = block?.warehouse?.value;

  // Section 65 is a fact about the warehouse; what this BE clears out of it is a
  // fact about the job. Both are held here so the finished-goods block appears
  // and disappears as the operator answers, rather than after a round trip.
  const [isSec65, setIsSec65] = useState(entries.isSec65ManufacturingWh);
  const [clearanceKind, setClearanceKind] = useState<ExBondClearanceKind | ''>(
    entries.exbondClearanceKind,
  );
  const [goods, setGoods] = useState<FinishedGoodEntry[]>(finishedGoods);
  const declaresFinishedGoods = isExBond && isSec65 && clearanceKind === 'resultant_product';

  const setGood = (i: number, patch: Partial<FinishedGoodEntry>) =>
    setGoods((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  // What one package weighs, which is the number the released weight comes from.
  const released = Number(entries.releasedPackages || '0');
  const perPackage = packing.find((p) => p.perPackageGrossKg !== undefined);
  const impliedWeight =
    released > 0 && perPackage?.perPackageGrossKg
      ? (perPackage.perPackageGrossKg * released).toFixed(3)
      : undefined;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">
        {isExBond ? 'Ex-bond clearance' : 'Warehousing'}
      </h2>
      <p className="mb-4 text-xs text-slate-500">
        {isExBond
          ? 'Since 1 September 2025 Customs releases only what its ledger holds against the into-bond BE, this importer’s IEC and this warehouse — so the code and the into-bond BE have to be exact.'
          : 'The bonded warehouse these goods are being deposited into, and the bond Customs holds against them.'}
      </p>

      <form action={action} className="space-y-4">
        <input type="hidden" name="jobId" value={jobId} />

        <dl className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
          <Row
            label="Warehouse"
            value={wh ? `${wh.name ?? 'name not known'} (${wh.code})` : undefined}
            r={block?.warehouse}
          />
          {wh?.stationName && (
            <div className="flex flex-wrap items-baseline">
              <dt className="w-28 shrink-0 text-slate-500">Licensed by</dt>
              <dd className="text-slate-700">
                {wh.stationName}
                {wh.type ? ` · ${wh.type} warehouse` : ''}
              </dd>
            </div>
          )}
          {isExBond && (
            <Row label="Into-bond BE" value={block?.inBondBeNo?.value} r={block?.inBondBeNo} />
          )}
          <Row label="Bond no" value={block?.bondNo?.value} r={block?.bondNo} />
        </dl>

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Warehouse</legend>
          <label className={LABEL} htmlFor="warehouseCode">
            Warehouse code
          </label>
          <input
            className={FIELD}
            id="warehouseCode"
            name="warehouseCode"
            placeholder="MAA1U001"
            defaultValue={entries.warehouseCode}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Eight characters: four of port, one licence letter (U public, R private, P special),
            three of serial.
          </p>
        </fieldset>

        {isExBond && (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">
              Into-bond Bill of Entry
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="inbondBeNo">
                  BE number
                </label>
                <input
                  className={FIELD}
                  id="inbondBeNo"
                  name="inbondBeNo"
                  defaultValue={entries.inbondBeNo}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="inbondBeDate">
                  BE date
                </label>
                <input
                  className={FIELD}
                  id="inbondBeDate"
                  name="inbondBeDate"
                  type="date"
                  defaultValue={entries.inbondBeDate}
                />
              </div>
            </div>
          </fieldset>
        )}

        {isExBond && (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">
              What is being released
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL} htmlFor="releasedPackages">
                  Packages released
                </label>
                <input
                  className={FIELD}
                  id="releasedPackages"
                  name="releasedPackages"
                  type="number"
                  min="1"
                  defaultValue={entries.releasedPackages}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="releasedGrossWeightKg">
                  Gross weight (kg)
                </label>
                <input
                  className={FIELD}
                  id="releasedGrossWeightKg"
                  name="releasedGrossWeightKg"
                  type="number"
                  step="0.001"
                  placeholder={impliedWeight ?? 'from the packing list'}
                  defaultValue={entries.releasedGrossWeightKg}
                />
              </div>
            </div>

            {/* The arithmetic, shown rather than assumed. */}
            {packing.length > 0 && (
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                <div className="mb-1 font-medium text-slate-700">From the packing list</div>
                <ul className="space-y-0.5">
                  {packing.map((p) => (
                    <li key={p.slNo}>
                      #{p.slNo} {p.description.slice(0, 40)} — {p.packages}{' '}
                      {p.packageType ?? 'package'}
                      {p.perPackageGrossKg !== undefined
                        ? ` at ${p.perPackageGrossKg} kg each`
                        : ', no weight per package'}
                    </li>
                  ))}
                </ul>
                {impliedWeight && (
                  <div className="mt-1.5 text-slate-700">
                    {released} × {perPackage!.perPackageGrossKg} kg ={' '}
                    <strong>{impliedWeight} kg</strong> — used unless you enter a weight.
                  </div>
                )}
              </div>
            )}
            {packing.length === 0 && (
              <p className="mt-2 text-[11px] text-amber-700">
                The packing list gave no per-product rows, so no weight per package could be
                derived. Enter the released gross weight yourself.
              </p>
            )}
          </fieldset>
        )}

        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">Bond</legend>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL} htmlFor="bondNo">
                Bond no
              </label>
              <input className={FIELD} id="bondNo" name="bondNo" defaultValue={entries.bondNo} />
            </div>
            <div>
              <label className={LABEL} htmlFor="bondDate">
                Date
              </label>
              <input
                className={FIELD}
                id="bondDate"
                name="bondDate"
                type="date"
                defaultValue={entries.bondDate}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="bondExpiryDate">
                Expiry
              </label>
              <input
                className={FIELD}
                id="bondExpiryDate"
                name="bondExpiryDate"
                type="date"
                defaultValue={entries.bondExpiryDate}
              />
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                name="isWarehouseSale"
                defaultChecked={entries.isWarehouseSale}
              />
              Warehouse sale
            </label>
            <label className="flex items-start gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                name="isSec65ManufacturingWh"
                checked={isSec65}
                onChange={(e) => setIsSec65(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Section 65 manufacturing warehouse
                <span className="block text-slate-400">
                  The warehouse holds a MOOWR permission to manufacture. A property of the
                  warehouse, not of this filing.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {isExBond && isSec65 && (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">
              What this clearance takes out
            </legend>
            <p className="mb-2 text-[11px] text-slate-400">
              Not everything leaving a section 65 warehouse is a manufactured product. Goods that
              were never worked on are cleared as such, with interest under section 61 (Circular
              48/2020, para 8.1), and declaring them as a resultant product is a rejection.
            </p>
            <div className="space-y-1.5">
              {CLEARANCE_KINDS.map((kind) => (
                <label
                  key={kind.value}
                  className="flex items-start gap-2 text-xs text-slate-700"
                >
                  <input
                    type="radio"
                    name="exbondClearanceKind"
                    value={kind.value}
                    checked={clearanceKind === kind.value}
                    onChange={() => setClearanceKind(kind.value)}
                    className="mt-0.5"
                  />
                  <span>
                    {kind.label}
                    <span className="block text-slate-400">{kind.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {declaresFinishedGoods && (
          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-medium text-slate-600">
              Finished goods cleared
            </legend>
            <p className="mb-3 text-[11px] text-slate-400">
              The items on this Bill of Entry are the imported <em>inputs</em>. These are the
              products they were manufactured into, and the GST invoices they were sold under.
              Every item needs at least one against it, or Customs refuses the filing.
            </p>

            <input type="hidden" name="sec65Count" value={goods.length} />

            <div className="space-y-3">
              {goods.map((good, i) => (
                <div key={i} className="rounded-lg bg-slate-50 p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500">
                      Finished product {i + 1}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] text-slate-400 hover:text-red-600"
                      onClick={() => setGoods((rows) => rows.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_gstInvoiceNo`}>
                        GST invoice no
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_gstInvoiceNo`}
                        name={`sec65_${i}_gstInvoiceNo`}
                        maxLength={16}
                        value={good.gstInvoiceNo}
                        onChange={(e) => setGood(i, { gstInvoiceNo: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_gstInvoiceDate`}>
                        GST invoice date
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_gstInvoiceDate`}
                        name={`sec65_${i}_gstInvoiceDate`}
                        type="date"
                        value={good.gstInvoiceDate}
                        onChange={(e) => setGood(i, { gstInvoiceDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_cth`}>
                        Finished product CTH
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_cth`}
                        name={`sec65_${i}_cth`}
                        placeholder="39269099"
                        maxLength={8}
                        value={good.cth}
                        onChange={(e) => setGood(i, { cth: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_description`}>
                        Description
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_description`}
                        name={`sec65_${i}_description`}
                        value={good.description}
                        onChange={(e) => setGood(i, { description: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_quantity`}>
                        Quantity cleared
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_quantity`}
                        name={`sec65_${i}_quantity`}
                        inputMode="decimal"
                        value={good.quantity}
                        onChange={(e) => setGood(i, { quantity: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`sec65_${i}_uqc`}>
                        Unit
                      </label>
                      <input
                        className={FIELD}
                        id={`sec65_${i}_uqc`}
                        name={`sec65_${i}_uqc`}
                        placeholder="NOS"
                        maxLength={3}
                        value={good.uqc}
                        onChange={(e) => setGood(i, { uqc: e.target.value.toUpperCase() })}
                      />
                    </div>
                  </div>

                  <div className="mt-2">
                    <label className={LABEL} htmlFor={`sec65_${i}_itemSrNos`}>
                      Made from item
                    </label>
                    <input
                      className={FIELD}
                      id={`sec65_${i}_itemSrNos`}
                      name={`sec65_${i}_itemSrNos`}
                      placeholder={`all ${itemSrNos.length} items`}
                      value={good.itemSrNos}
                      onChange={(e) => setGood(i, { itemSrNos: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      Item serials, comma separated. Leave empty when every input on this BE went
                      into this product — which is the usual case.
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="mt-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              onClick={() => setGoods((rows) => [...rows, { ...EMPTY_FINISHED_GOOD }])}
            >
              + Add a finished product
            </button>
          </fieldset>
        )}

        <button className={PRIMARY} disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Save bond details'}
        </button>
        <Note state={state} />
      </form>
    </section>
  );
}
