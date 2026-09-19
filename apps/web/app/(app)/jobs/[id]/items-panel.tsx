'use client';

import { useActionState, useState, type ReactElement } from 'react';
import { saveItem, sendFtaBenefitQuestion, type ItemActionState } from './items-actions';
import { BUTTON, Note, PRIMARY, SMALL_FIELD } from './ui';

/**
 * The ITEMS sheet as the operator sees it (docs/boe-mapping/06-items.md).
 *
 * Every line shows what will be filed and where each decidable value came from
 * — document, master, mail, operator, or nobody yet. The customer's rule for a
 * description this importer has never filed is to look at it once: the line
 * opens with "confirm", and confirming it remembers the classification, brand,
 * model and end use for the next job.
 */

export type ItemSource = 'document' | 'master' | 'mail' | 'operator' | 'default';

export interface ItemRowView {
  invoiceSrNo: number;
  slNo: number;
  description: string;
  quantity: number;
  unit: string;
  ritc: string;
  generalDescription: string;
  brand: string;
  model: string;
  endUseCode: string;
  originCountry: string;
  manufacturerName: string;
  manufacturerAddress: string;
  eximCode: string;
  accessoryStatus: string;
  accessoriesDetails: string;
  foc: boolean;
  previousBe: { beNo: string; beDate: string; customHouse: string; currency: string; unitPrice: string };
  /** Present only when this line came back from an export — the RE-IMPORT sheet. */
  reImport?: ReImportRowView;
  sources: Partial<Record<string, ItemSource>>;
  /** Notification lines as they will be filed, for display. */
  duties: { label: string; value: string }[];
  fta?: { scheme: string; notification: string; serial: string; cooNumber: string; retroactive: string; compliant: boolean };
  tradeRemedyCandidates: { label: string }[];
  tradeRemedies: string[];
  flags: { severity: 'error' | 'warning' | 'info'; message: string }[];
}

/**
 * A line's re-import block, as the operator has to decide it.
 *
 * The shipping bill's own facts are read and shown, not asked for. The one
 * thing this screen exists to collect is which entry of the notification is
 * being claimed — the bill's scheme flags usually fit several, one row carries
 * one, and the entry decides which of the amounts below Customs demands and
 * which it rejects. Nothing is preselected.
 */
export interface ReImportRowView {
  sbNo: string;
  sbDate: string;
  portOfExport: string;
  sbInvSrNo: string;
  sbItemSrNo: string;
  /** `NNN/YYYY serial`, or empty while nobody has chosen. */
  chosen: string;
  confirmed: boolean;
  candidates: {
    key: string;
    notification: string;
    serial: string;
    description: string;
    amountPayable: string;
    because: string;
    cautions: string[];
    needsExportFreightInsurance: boolean;
    needsIncentiveRepayment: boolean;
  }[];
  exportFreightInr: string;
  exportInsuranceInr: string;
  customsDuty: string;
  exciseDuty: string;
  igstPaid: string;
  /** Set when the goods are outside the notifications altogether. */
  exclusion: string;
}

export interface ItemsPanelProps {
  jobId: string;
  items: ItemRowView[];
  endUseCodes: { code: string; label: string }[];
  eximSchemes: { code: string; label: string }[];
  ftaQuestion?: { to: string; subject: string; body: string };
}

const SOURCE_STYLE: Record<ItemSource, string> = {
  document: 'bg-slate-100 text-slate-600',
  master: 'bg-indigo-50 text-indigo-700',
  mail: 'bg-sky-50 text-sky-700',
  operator: 'bg-emerald-50 text-emerald-700',
  default: 'bg-amber-50 text-amber-700',
};

function Source({ source }: { source: ItemSource | undefined }) {
  if (!source) return null;
  return (
    <span className={`ml-1 rounded px-1 py-px text-[10px] font-medium ${SOURCE_STYLE[source]}`}>
      {source === 'default' ? 'unconfirmed' : source}
    </span>
  );
}

function needsConfirm(row: ItemRowView) {
  return Boolean(row.sources.ritc && row.sources.ritc !== 'master' && row.sources.ritc !== 'operator');
}

function ItemForm({ jobId, row, endUseCodes, eximSchemes }: { jobId: string; row: ItemRowView } & Pick<ItemsPanelProps, 'endUseCodes' | 'eximSchemes'>) {
  const [state, action, pending] = useActionState<ItemActionState, FormData>(saveItem, {});
  const field = (name: string, label: string, value: string, source?: ItemSource, wide = false) => (
    <label className={`flex flex-col gap-1 text-xs text-slate-600 ${wide ? 'sm:col-span-2' : ''}`}>
      <span>
        {label}
        <Source source={source} />
      </span>
      <input name={name} defaultValue={value} className={SMALL_FIELD} />
    </label>
  );

  return (
    <form action={action} className="grid gap-3 border-t border-slate-100 px-5 py-4 sm:grid-cols-4">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="invoiceSrNo" value={row.invoiceSrNo} />
      <input type="hidden" name="itemSrNo" value={row.slNo} />

      {field('ritc', 'CTH', row.ritc, row.sources.ritc)}
      {field('generalDescription', 'General description', row.generalDescription, row.sources.generalDescription, true)}
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>
          End use
          <Source source={row.sources.endUseCode} />
        </span>
        <select name="endUseCode" defaultValue={row.endUseCode} className={SMALL_FIELD}>
          <option value="">— choose —</option>
          {endUseCodes.map((e) => (
            <option key={e.code} value={e.code}>
              {e.code} — {e.label}
            </option>
          ))}
        </select>
      </label>

      {field('brand', 'Brand', row.brand, row.sources.brand)}
      {field('model', 'Model', row.model)}
      {field('originCountry', 'Country of origin', row.originCountry, row.sources.originCountry)}
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" name="foc" defaultChecked={row.foc} /> Free of charge / no commercial value
      </label>

      {field('manufacturerName', 'Manufacturer', row.manufacturerName, row.sources.manufacturer, true)}
      {field('manufacturerAddress', 'Manufacturer address', row.manufacturerAddress, undefined, true)}

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>Exim scheme</span>
        <select name="eximCode" defaultValue={row.eximCode} className={SMALL_FIELD}>
          <option value="">None</option>
          {eximSchemes.map((e) => (
            <option key={e.code} value={e.code}>
              {e.code} — {e.label}
            </option>
          ))}
        </select>
      </label>
      {field('eximNotn', 'Scheme notification', '')}
      {field('policyPara', 'Policy para', '')}
      {field('policyYear', 'Policy year', '')}

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>Accessories</span>
        <select name="accessoryStatus" defaultValue={row.accessoryStatus} className={SMALL_FIELD}>
          <option value="0">0 — none</option>
          <option value="1">1 — supplied with the item</option>
          <option value="2">2 — declared as separate items</option>
        </select>
      </label>
      {field('accessoriesDetails', 'Accessories details', row.accessoriesDetails, undefined, true)}
      <div />

      {field('prevBeNo', 'Previous BE no.', row.previousBe.beNo)}
      {field('prevBeDate', 'Previous BE date', row.previousBe.beDate)}
      {field('prevCustomHouse', 'Previous custom house', row.previousBe.customHouse)}
      {field('prevUnitPrice', 'Previous unit price', row.previousBe.unitPrice)}

      {row.fta && (
        <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
          <span>Preferential claim</span>
          <select name="fta" defaultValue="" className={SMALL_FIELD}>
            <option value="">
              Keep: {row.fta.scheme} {row.fta.notification} S.No. {row.fta.serial}
            </option>
            <option value="retro-N">Keep — certificate checked, not issued retroactively</option>
            <option value="retro-Y">Keep — certificate checked, issued retroactively and marked</option>
            <option value="none">Do not claim</option>
          </select>
        </label>
      )}
      {(row.tradeRemedyCandidates.length > 0 || row.tradeRemedies.length > 0) && (
        <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
          <span>Trade remedy row</span>
          <select name="tradeRemedy" defaultValue="" className={SMALL_FIELD}>
            <option value="">{row.tradeRemedies.length ? `Keep: ${row.tradeRemedies.join(', ')}` : '— choose —'}</option>
            {row.tradeRemedyCandidates.map((c, i) => (
              <option key={i} value={i}>
                {c.label}
              </option>
            ))}
            <option value="none">None applies</option>
          </select>
        </label>
      )}

      {row.reImport && <ReImportFields re={row.reImport} field={field} />}

      <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <input type="checkbox" name="confirm" defaultChecked={needsConfirm(row)} />
          I have checked this line — remember it for this importer
        </label>
        <button type="submit" className={PRIMARY} disabled={pending}>
          {pending ? 'Saving…' : 'Save item'}
        </button>
      </div>
      <div className="sm:col-span-4">
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * The re-import block: the shipping bill, the entry to claim, and the amounts
 * that entry needs.
 *
 * The amount fields stay visible whichever entry is chosen, because which pair
 * applies is exactly what the choice decides and hiding them would make the
 * consequence invisible. The chosen entry's own line says which it wants.
 */
function ReImportFields({
  re,
  field,
}: {
  re: ReImportRowView;
  field: (name: string, label: string, value: string, source?: ItemSource, wide?: boolean) => ReactElement;
}) {
  const chosen = re.candidates.find((c) => c.key === re.chosen);
  return (
    <div className="sm:col-span-4 rounded border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-medium text-slate-700">Re-import</span>
        <span className="text-slate-500">
          Shipping bill {re.sbNo} dated {re.sbDate} from {re.portOfExport}, invoice {re.sbInvSrNo} item{' '}
          {re.sbItemSrNo}
        </span>
      </div>

      {re.exclusion && (
        <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-xs text-rose-800">{re.exclusion}</p>
      )}

      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>
          Notification entry claimed
          {re.confirmed ? <Source source="operator" /> : <Source source="default" />}
        </span>
        <select name="reImportEntry" defaultValue={re.chosen} className={SMALL_FIELD}>
          <option value="">
            {re.chosen ? `Keep: ${re.chosen}` : '— nothing claimed yet; the export will refuse —'}
          </option>
          {re.candidates.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key} — {c.description.slice(0, 90)}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {re.candidates.map((c) => (
          <li key={c.key} className={c.key === re.chosen ? 'rounded bg-white px-2 py-1' : 'px-2 py-1'}>
            <span className="font-medium">{c.key}</span> — {c.because}
            <div className="text-slate-500">Pays: {c.amountPayable}</div>
            <div className="text-slate-500">
              {c.needsExportFreightInsurance
                ? 'Needs the export leg’s freight and insurance, in rupees.'
                : c.needsIncentiveRepayment
                  ? 'Needs the incentive repaid.'
                  : 'No amount to declare.'}
            </div>
            {c.cautions.map((caution, i) => (
              <div key={i} className="text-amber-700">
                {caution}
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {field('reImportExportFreight', 'Export freight (₹, this line)', re.exportFreightInr)}
        {field('reImportExportInsurance', 'Export insurance (₹, this line)', re.exportInsuranceInr)}
        <div />
        {field('reImportCustomsDuty', 'Customs incentive repaid (₹)', re.customsDuty)}
        {field('reImportExciseDuty', 'Excise incentive repaid (₹)', re.exciseDuty)}
        {field('reImportIgstPaid', 'IGST refunded or unpaid at export (₹)', re.igstPaid)}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {chosen?.needsExportFreightInsurance
          ? 'This entry values the goods on the cost of the work done abroad plus insurance and freight both ways, so the export leg’s figures are part of the value. They come off the shipper’s certificates or the shipping bill — in rupees, apportioned to this line, and not the inbound freight, which belongs to the invoice.'
          : chosen?.needsIncentiveRepayment
            ? 'This entry repays what the export claimed. The figure is on the export invoice or in the importer’s instruction — it is a payment, not something to compute from a drawback rate.'
            : 'This entry declares no amount. Anything entered above will be refused.'}
      </p>
    </div>
  );
}

function FtaQuestion({ jobId, question }: { jobId: string; question: NonNullable<ItemsPanelProps['ftaQuestion']> }) {
  const [state, action, pending] = useActionState<ItemActionState, FormData>(sendFtaBenefitQuestion, {});
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{question.subject}</span>
        <button type="button" className={BUTTON} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Ask the importer'}
        </button>
      </div>
      {open && (
        <form action={action} className="mt-3 grid gap-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input name="to" defaultValue={question.to} placeholder="importer@example.com" className={SMALL_FIELD} />
          <input name="subject" defaultValue={question.subject} className={SMALL_FIELD} />
          <textarea name="body" defaultValue={question.body} rows={10} className={SMALL_FIELD} />
          <div>
            <button type="submit" className={PRIMARY} disabled={pending}>
              {pending ? 'Sending…' : 'Send from my mailbox'}
            </button>
          </div>
          <Note state={state} />
        </form>
      )}
    </div>
  );
}

export function ItemsPanel({ jobId, items, endUseCodes, eximSchemes, ftaQuestion }: ItemsPanelProps) {
  const [open, setOpen] = useState<string | null>(() => {
    const first = items.find(needsConfirm);
    return first ? `${first.invoiceSrNo}/${first.slNo}` : null;
  });
  const unconfirmed = items.filter(needsConfirm).length;
  const blocking = items.filter((r) => r.flags.some((f) => f.severity === 'error')).length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-sm font-semibold">Items</h2>
        <span className="text-xs text-slate-500">
          {items.length} line{items.length === 1 ? '' : 's'}
          {unconfirmed > 0 && ` · ${unconfirmed} to confirm`}
          {blocking > 0 && ` · ${blocking} with errors`}
        </span>
      </div>

      {ftaQuestion && <FtaQuestion jobId={jobId} question={ftaQuestion} />}

      {items.length === 0 && <p className="px-5 py-4 text-xs text-slate-500">The documents have not been read yet.</p>}

      <ul>
        {items.map((row) => {
          const key = `${row.invoiceSrNo}/${row.slNo}`;
          const isOpen = open === key;
          return (
            <li key={key} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left text-xs hover:bg-slate-50"
              >
                <span className="font-mono text-slate-400">{key}</span>
                <span className="font-medium text-slate-900">{row.description}</span>
                <span className="text-slate-500">
                  {row.quantity} {row.unit}
                </span>
                <span className="font-mono">
                  {row.ritc}
                  <Source source={row.sources.ritc} />
                </span>
                {row.fta && (
                  <span className={`rounded px-1.5 py-px ${row.fta.compliant ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {row.fta.scheme} {row.fta.serial}
                  </span>
                )}
                {needsConfirm(row) && <span className="rounded bg-amber-100 px-1.5 py-px text-amber-800">confirm</span>}
              </button>
              {isOpen && (
                <>
                  <div className="grid gap-x-6 gap-y-1 px-5 pb-2 text-[11px] text-slate-600 sm:grid-cols-3">
                    {row.duties.map((d) => (
                      <div key={d.label}>
                        <span className="text-slate-400">{d.label}:</span> {d.value}
                      </div>
                    ))}
                  </div>
                  {row.flags.length > 0 && (
                    <ul className="mx-5 mb-2 space-y-1">
                      {row.flags.map((f, i) => (
                        <li
                          key={i}
                          className={`rounded px-2 py-1 text-[11px] ${
                            f.severity === 'error'
                              ? 'bg-red-50 text-red-700'
                              : f.severity === 'warning'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-slate-50 text-slate-600'
                          }`}
                        >
                          {f.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ItemForm jobId={jobId} row={row} endUseCodes={endUseCodes} eximSchemes={eximSchemes} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
