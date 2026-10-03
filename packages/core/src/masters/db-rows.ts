import {
  BCD_CONDITIONS,
  BCD_EXEMPTIONS,
  BCD_EXEMPTION_NOTIFICATION,
  COMP_CESS_NOTIFICATION,
  COMP_CESS_SCHEDULE,
  COMP_CESS_UNAPPLIED_AMENDMENTS,
  IGST_RATE_NOTIFICATION,
  IGST_RATE_NOTIFICATION_EFFECTIVE_FROM,
  IGST_SCHEDULE,
  type BcdExemptionEntry,
} from './data.js';
import {
  ftaAgreements,
  ftaSchedule,
  loadItemMaster,
  tradeRemedyEntries,
  type ExemptionEntry,
  type LeviesFile,
  type LevyEntry,
  type TariffValuesFile,
  type TradeRemedyEntry,
} from './item-masters.js';
import { allTariff } from './store.js';
import { tariffBook, tariffBookInForceFrom } from './tariff-book.js';

/**
 * The masters as database rows — the shape of the Supabase mirror.
 *
 * The code stays the source of truth: every row here is derived from the same
 * generated files the duty engine reads, so the database can never say
 * something the checklist does not. What the mirror adds is a queryable,
 * dated table — one row per tariff line and one per notification entry, each
 * with the dates it is in force — that SQL, a picker screen or an auditor can
 * read without loading the app.
 *
 * Every row has a `valid_from`. Where a source does not date a row itself the
 * date is the notification's own in-force date, never the build date and
 * never a guess; `dateSource` on the release says which rows were dated that
 * way.
 */

export type DutyType =
  | 'BCD'
  | 'AIDC'
  | 'SWS'
  | 'IGST'
  | 'COMP_CESS'
  | 'HEALTH_CESS'
  | 'ANTI_DUMPING'
  | 'CVD'
  | 'SAFEGUARD'
  | 'TARIFF_VALUE';

export type RateBasis =
  | 'AD_VALOREM'
  | 'SPECIFIC'
  | 'LANDED_PERCENT'
  | 'REFERENCE_PRICE'
  | 'REDUCTION'
  | 'TARIFF_VALUE'
  | 'TEXT';

export interface TariffLineRow {
  cth: string;
  description: string;
  unit: string | null;
  basic_bcd_rate: number | null;
  effective_bcd_rate: number | null;
  pref_bcd_rate: number | null;
  igst_rate: number | null;
  sws_rate: number | null;
  rate_text: string | null;
  import_policy: string | null;
  export_policy: string | null;
  remarks: string | null;
  notification_refs: unknown[];
  source: 'book' | 'seed' | 'learned' | 'reviewer';
  edition: string | null;
  confidence: string | null;
  page: number | null;
  valid_from: string;
  valid_to: string | null;
}

export interface NotificationEntryRow {
  /** Stable within a release: what the row is, plus its start date. */
  entry_key: string;
  duty_type: DutyType;
  notification: string;
  /** Trade agreement key for a preferential row (`IN-AE-CEPA`), else null. */
  scheme: string | null;
  table_no: string | null;
  serial: string | null;
  /** The roman-numeral sub-item of a stacked serial, '' for the serial itself. */
  sub_entry: string;
  description: string;
  include_codes: string[];
  exclude_codes: string[];
  any_chapter: boolean;
  all_goods: boolean;
  spec: string | null;
  origin_countries: string[];
  export_countries: string[];
  basis: RateBasis;
  rate_percent: number | null;
  rate_text: string | null;
  amount: number | null;
  amount_currency: string | null;
  amount_unit: string | null;
  condition_refs: string[];
  conditions: string[];
  valid_from: string;
  valid_to: string | null;
  stale_from: string | null;
  stale_by: string[];
  amended_by: string[];
  omitted_by: string | null;
  page: number | null;
  extra: Record<string, unknown>;
}

export interface NotificationConditionRow {
  notification: string;
  table_no: string;
  condition_no: string;
  kinds: string[];
  text: string;
  stale_by: string[];
}

/**
 * In-force dates for notifications whose rows the sources leave undated.
 * Each is the notification's own "shall come into force" date.
 */
const NOTIFICATION_IN_FORCE: Record<string, string> = {
  // 1/2017-Compensation Cess (Rate): with GST, 1 July 2017.
  [COMP_CESS_NOTIFICATION]: '2017-07-01',
  // 10/2025-Integrated Tax (Rate), issued 17 September 2025 beside 9/2025 to
  // supersede 2/2017-IT(R); both in force from 22 September 2025.
  '010/2025': IGST_RATE_NOTIFICATION_EFFECTIVE_FROM,
  [IGST_RATE_NOTIFICATION]: IGST_RATE_NOTIFICATION_EFFECTIVE_FROM,
};

/** First day the BCD serial is in force across all its versions, and the last. */
function bcdSerialSpan(table: string, serial: string): { from: string; to: string | null } | undefined {
  const versions = BCD_EXEMPTIONS.filter((e) => e.table === table && e.serial === serial);
  if (!versions.length) return undefined;
  const from = versions.map((e) => e.validFrom).sort()[0]!;
  const to = versions.some((e) => !e.validUntil) ? null : versions.map((e) => e.validUntil!).sort().at(-1)!;
  return { from, to };
}

function base(row: Partial<NotificationEntryRow> & Pick<NotificationEntryRow, 'duty_type' | 'notification' | 'description' | 'valid_from'>): Omit<NotificationEntryRow, 'entry_key'> {
  return {
    scheme: null,
    table_no: null,
    serial: null,
    sub_entry: '',
    include_codes: [],
    exclude_codes: [],
    any_chapter: false,
    all_goods: false,
    spec: null,
    origin_countries: [],
    export_countries: [],
    basis: 'TEXT',
    rate_percent: null,
    rate_text: null,
    amount: null,
    amount_currency: null,
    amount_unit: null,
    condition_refs: [],
    conditions: [],
    valid_to: null,
    stale_from: null,
    stale_by: [],
    amended_by: [],
    omitted_by: null,
    page: null,
    extra: {},
    ...row,
  };
}

const percent = (rate: number | null | undefined): Pick<NotificationEntryRow, 'basis' | 'rate_percent'> =>
  rate === null || rate === undefined ? { basis: 'TEXT', rate_percent: null } : { basis: 'AD_VALOREM', rate_percent: rate };

/* ------------------------------------------------------------------ *
 * Tariff lines
 * ------------------------------------------------------------------ */

/**
 * One row per tariff item, as the app resolves it: the reviewer overlay over
 * the hand-typed seed over the printed tariff. Book rows the duty engine
 * skips (no readable rate) are kept with null rates, because knowing a code
 * exists is what "is this CTH valid" needs.
 */
export function tariffLineRows(): TariffLineRow[] {
  const book = tariffBook();
  const bookFrom = tariffBookInForceFrom() ?? null;
  const rows = new Map<string, TariffLineRow>();

  for (const r of book?.rows ?? []) {
    if (!bookFrom) break;
    rows.set(r.cth, {
      cth: r.cth,
      description: r.description,
      unit: r.unit ?? null,
      basic_bcd_rate: r.basicBcdRate ?? null,
      effective_bcd_rate: r.effectiveBcdRate ?? null,
      pref_bcd_rate: r.prefBcdRate ?? null,
      igst_rate: r.igstRate ?? null,
      sws_rate: r.swsRate ?? null,
      rate_text: r.rateText ?? null,
      import_policy: r.impPolicy ?? null,
      export_policy: r.expPolicy ?? null,
      remarks: r.remarks ?? null,
      notification_refs: r.notificationRefs ?? [],
      source: 'book',
      edition: book!.edition,
      confidence: r.confidence,
      page: r.page,
      valid_from: bookFrom,
      valid_to: null,
    });
  }

  for (const t of allTariff()) {
    const source = t.provenance?.source ?? 'seed';
    if (source === 'book' && rows.has(t.cth)) continue; // already carried, with the raw fields
    const prior = rows.get(t.cth);
    rows.set(t.cth, {
      cth: t.cth,
      description: t.description,
      unit: t.unit || null,
      basic_bcd_rate: t.basicBcdRate ?? t.bcdRate,
      effective_bcd_rate: t.effectiveBcdRate ?? null,
      pref_bcd_rate: t.prefBcdRate ?? null,
      igst_rate: t.igstRate,
      sws_rate: t.swsRate ?? null,
      rate_text: t.rateText ?? null,
      import_policy: t.impPolicy ?? prior?.import_policy ?? null,
      export_policy: t.expPolicy ?? prior?.export_policy ?? null,
      remarks: t.remarks ?? null,
      notification_refs: t.notificationRefs ?? [],
      source,
      edition: t.provenance?.edition ?? null,
      confidence: t.provenance?.confidence ?? null,
      page: t.provenance?.page ?? null,
      // A seed or reviewer row was transcribed from a filed job and makes no
      // claim about when the rate began. It stands in for the book's reading,
      // so it takes the book's date rather than inventing one of its own.
      valid_from: t.validFrom ?? prior?.valid_from ?? bookFrom ?? IGST_RATE_NOTIFICATION_EFFECTIVE_FROM,
      valid_to: null,
    });
  }
  return [...rows.values()].sort((a, b) => a.cth.localeCompare(b.cth));
}

/* ------------------------------------------------------------------ *
 * Notification entries
 * ------------------------------------------------------------------ */

function bcdRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  const out: Omit<NotificationEntryRow, 'entry_key'>[] = [];
  const shared = (e: BcdExemptionEntry) => ({
    duty_type: 'BCD' as const,
    notification: BCD_EXEMPTION_NOTIFICATION,
    table_no: e.table,
    serial: e.serial,
    description: e.description,
    include_codes: e.include,
    exclude_codes: e.exclude ?? [],
    any_chapter: Boolean(e.anyChapter),
    spec: e.spec,
    valid_from: e.validFrom,
    valid_to: e.validUntil ?? null,
    stale_from: e.staleFrom ?? null,
    stale_by: e.staleBy ?? [],
    amended_by: e.amendedBy ?? [],
    omitted_by: e.omittedBy ?? null,
    page: e.page,
  });
  for (const e of BCD_EXEMPTIONS) {
    out.push(
      base({
        ...shared(e),
        ...percent(e.bcdRate),
        rate_text: e.bcdRateText,
        condition_refs: e.conditions,
        extra: { conditionCell: e.condition },
      }),
    );
    for (const sub of e.subEntries ?? []) {
      out.push(
        base({
          ...shared(e),
          sub_entry: sub.label,
          description: sub.text,
          ...percent(sub.bcdRate),
          rate_text: sub.bcdRateText,
          condition_refs: sub.conditions,
          extra: { serialDescription: e.description },
        }),
      );
    }
  }
  return out;
}

function igstScheduleRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  return IGST_SCHEDULE.map((e) =>
    base({
      duty_type: 'IGST',
      notification: IGST_RATE_NOTIFICATION,
      table_no: e.schedule,
      serial: e.serial,
      description: e.description,
      include_codes: e.include,
      exclude_codes: e.exclude ?? [],
      any_chapter: Boolean(e.anyChapter),
      spec: e.spec,
      ...percent(e.rate),
      rate_text: `${e.rate}%`,
      valid_from: NOTIFICATION_IN_FORCE[IGST_RATE_NOTIFICATION]!,
      page: e.page,
      extra: { schedule: e.schedule },
    }),
  );
}

function compCessRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  return COMP_CESS_SCHEDULE.map((e) =>
    base({
      duty_type: 'COMP_CESS',
      notification: COMP_CESS_NOTIFICATION,
      serial: e.serial,
      description: e.description,
      include_codes: e.include,
      exclude_codes: e.exclude ?? [],
      any_chapter: Boolean(e.anyChapter),
      spec: e.spec,
      ...percent(e.rate),
      rate_text: e.rateText,
      valid_from: NOTIFICATION_IN_FORCE[COMP_CESS_NOTIFICATION]!,
      page: e.page,
      // Nineteen amendments to this Schedule are not applied. They only move
      // named serials, so the residual S.No. 56 is untouched by them.
      extra: {
        ...(e.brandSensitive && { brandSensitive: true }),
        ...(!e.anyChapter && { unappliedAmendments: COMP_CESS_UNAPPLIED_AMENDMENTS }),
      },
    }),
  );
}

function levyRow(
  duty_type: DutyType,
  notification: string,
  e: LevyEntry,
  fallbackFrom: string,
): Omit<NotificationEntryRow, 'entry_key'> {
  return base({
    duty_type,
    notification,
    serial: e.serial,
    description: e.description,
    include_codes: e.include,
    exclude_codes: e.exclude ?? [],
    any_chapter: Boolean(e.anyChapter),
    all_goods: Boolean(e.allGoods),
    ...percent(e.rate),
    rate_text: e.rateText ?? null,
    conditions: e.conditions ?? [],
    valid_from: e.validFrom ?? fallbackFrom,
    valid_to: e.validUntil ?? null,
    amended_by: e.amendedBy ?? [],
    page: e.page ?? null,
    extra: {
      ...(e.kind && { kind: e.kind }),
      ...(e.refs?.length && { refs: e.refs }),
      ...(!e.validFrom && { dateSource: 'notification' }),
    },
  });
}

function levyRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  const file = loadItemMaster<LeviesFile>('levies.json');
  if (!file) return [];
  const out: Omit<NotificationEntryRow, 'entry_key'>[] = [];
  const src = (e: LevyEntry & { source?: string }, fallback: string) => e.source ?? fallback;

  for (const e of file.aidc.entries) out.push(levyRow('AIDC', src(e, file.aidc.notification), e, ''));
  for (const e of file.aidc.otherExemptions ?? []) out.push(levyRow('AIDC', e.notification, e, ''));
  for (const e of file.swsExemption.entries) out.push(levyRow('SWS', src(e, file.swsExemption.notification), e, ''));
  for (const e of file.healthCess?.entries ?? [])
    out.push(levyRow('HEALTH_CESS', src(e, file.healthCess?.exemptionNotification ?? ''), e, ''));

  const exemption = (duty: DutyType, e: ExemptionEntry) => {
    // 45/2025's IGST and cess cells live on the same serial as its BCD: the
    // dates are that serial's. 10/2025-IT(R) is dated by its own in-force date.
    const span = e.notification === BCD_EXEMPTION_NOTIFICATION && 'table' in e
      ? bcdSerialSpan(String((e as ExemptionEntry & { table: string }).table), e.serial)
      : undefined;
    const from = e.validFrom ?? span?.from ?? NOTIFICATION_IN_FORCE[e.notification] ?? '';
    const row = levyRow(duty, e.notification, e, from);
    return {
      ...row,
      table_no: 'table' in e ? String((e as ExemptionEntry & { table: string }).table) : null,
      valid_to: e.validUntil ?? span?.to ?? null,
      ...(duty === 'IGST' && { ...percent(e.igstRate ?? e.rate), rate_text: e.igstRateText ?? e.rateText ?? null }),
      extra: { ...row.extra, exemptionType: e.type },
    };
  };
  for (const e of file.igstExemptions) out.push(exemption('IGST', e));
  for (const e of file.compCessExemptions) out.push(exemption('COMP_CESS', e));
  return out;
}

const REMEDY_DUTY: Record<TradeRemedyEntry['kind'], DutyType> = {
  ADD: 'ANTI_DUMPING',
  CVD: 'CVD',
  SAFEGUARD: 'SAFEGUARD',
};

function remedyBasis(basis: string | null): RateBasis {
  switch (basis) {
    case 'SPECIFIC':
      return 'SPECIFIC';
    case 'CIF_PCT':
    case 'AV':
      return 'AD_VALOREM';
    case 'LANDED_PCT':
      return 'LANDED_PERCENT';
    case 'REFERENCE_PRICE':
      return 'REFERENCE_PRICE';
    default:
      return 'TEXT';
  }
}

function tradeRemedyRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  return tradeRemedyEntries().map((e) =>
    base({
      duty_type: REMEDY_DUTY[e.kind],
      notification: e.notificationShort ?? e.notification,
      table_no: null,
      serial: e.tableSerial,
      sub_entry: e.supplierSerial ?? '',
      description: e.specification ? `${e.description} — ${e.specification}` : e.description,
      include_codes: e.include,
      exclude_codes: e.exclude ?? [],
      any_chapter: Boolean(e.anyChapter),
      origin_countries: e.originCountries,
      export_countries: e.exportCountries,
      basis: remedyBasis(e.basis),
      rate_percent: e.rate,
      amount: e.amount,
      amount_currency: e.currency,
      amount_unit: e.unit,
      valid_from: e.validFrom ?? e.notificationDate ?? '',
      valid_to: e.validUntil,
      page: e.page ?? null,
      extra: {
        notificationTitle: e.notification,
        producer: e.producer,
        exporter: e.exporter,
        ...(e.residual && { residual: e.residual }),
        ...(e.validityInferred && { validityInferred: true }),
        ...(e.rescindedBy && { rescindedBy: e.rescindedBy }),
        ...(e.originExcept?.length && { originExcept: e.originExcept }),
        ...(e.exportExcept?.length && { exportExcept: e.exportExcept }),
        ...(e.originOrExport && { originOrExport: true }),
        ...(e.dutyNotes?.length && { dutyNotes: e.dutyNotes }),
        ...(e.notLeviedAtOrAboveCifPrice?.length && { notLeviedAtOrAboveCifPrice: e.notLeviedAtOrAboveCifPrice }),
      },
    }),
  );
}

function tariffValueRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  const file = loadItemMaster<TariffValuesFile>('tariff-values.json');
  if (!file) return [];
  return file.editions.flatMap((edition) =>
    edition.rows.map((r) =>
      base({
        duty_type: 'TARIFF_VALUE',
        notification: edition.notification,
        table_no: r.table,
        serial: String(r.serial),
        description: r.description,
        include_codes: r.include,
        exclude_codes: r.exclude ?? [],
        basis: 'TARIFF_VALUE',
        amount: r.amount,
        amount_currency: r.currency,
        amount_unit: r.uqc,
        rate_text: `${r.currency} ${r.amount} ${r.unitText}`,
        valid_from: edition.effectiveFrom,
        valid_to: edition.effectiveUntil,
        page: r.page ?? null,
        extra: { per: r.per, baseNotification: file.baseNotification },
      }),
    ),
  );
}

function ftaRows(): Omit<NotificationEntryRow, 'entry_key'>[] {
  const out: Omit<NotificationEntryRow, 'entry_key'>[] = [];
  for (const agreement of ftaAgreements()) {
    const lines = ftaSchedule(agreement.key) ?? [];
    for (const line of lines) {
      const reduction = /reduction/i.test(line.rateMeaning ?? '');
      out.push(
        base({
          duty_type: 'BCD',
          notification: line.notification ?? agreement.concessionNotifications[0]?.notification ?? agreement.key,
          scheme: agreement.key,
          serial: line.serial,
          description: line.description,
          include_codes: line.include,
          exclude_codes: line.exclude ?? [],
          any_chapter: Boolean(line.anyChapter),
          origin_countries: agreement.partners,
          basis: line.rate === null || line.rate === undefined ? 'TEXT' : reduction ? 'REDUCTION' : 'AD_VALOREM',
          rate_percent: line.rate ?? null,
          rate_text: line.rateText ?? null,
          conditions: line.conditions ?? [],
          valid_from: line.validFrom ?? agreement.inForceFrom ?? '',
          valid_to: line.validUntil ?? agreement.inForceUntil ?? null,
          page: line.page ?? null,
          extra: {
            slot: line.slot ?? agreement.slot,
            ...(line.rateMeaning && { rateMeaning: line.rateMeaning }),
          },
        }),
      );
    }
  }
  return out;
}

/**
 * Every notification entry the masters hold, each with a key unique within
 * the set. The key names what the row is and when it starts; where a source
 * repeats that (an FTA notification with several tables numbered from 1), a
 * `#2`, `#3` in source order keeps it unique and stable between builds.
 */
export function notificationEntryRows(): NotificationEntryRow[] {
  const rows = [
    ...bcdRows(),
    ...igstScheduleRows(),
    ...compCessRows(),
    ...levyRows(),
    ...tradeRemedyRows(),
    ...tariffValueRows(),
    ...ftaRows(),
  ];
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = [r.duty_type, r.scheme ?? '', r.notification, r.table_no ?? '', r.serial ?? '', r.sub_entry, r.valid_from].join('|');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { entry_key: n === 1 ? key : `${key}#${n}`, ...r };
  });
}

export function notificationConditionRows(): NotificationConditionRow[] {
  return BCD_CONDITIONS.map((c) => ({
    notification: BCD_EXEMPTION_NOTIFICATION,
    table_no: c.table,
    condition_no: c.no,
    kinds: c.kinds,
    text: c.text,
    stale_by: c.staleBy ?? [],
  }));
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export interface MasterRowsReport {
  tariffLines: number;
  notificationEntries: number;
  conditions: number;
  byDutyType: Record<string, number>;
  /** Rows dated by their notification's in-force date rather than their own. */
  datedByNotification: number;
  problems: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the database constraints will refuse, checked before a byte is sent:
 * every row dated, no range ending before it starts, unique keys, and no
 * tariff line or 45/2025 serial with two versions in force on one day.
 */
export function checkMasterRows(
  tariff: TariffLineRow[],
  entries: NotificationEntryRow[],
  conditions: NotificationConditionRow[],
): MasterRowsReport {
  const problems: string[] = [];
  const dated = (what: string, from: string, to: string | null) => {
    if (!ISO.test(from)) problems.push(`${what}: valid_from ${JSON.stringify(from)} is not a date`);
    else if (to !== null && (!ISO.test(to) || to < from)) problems.push(`${what}: valid_to ${to} is before valid_from ${from}`);
  };

  const cths = new Set<string>();
  for (const t of tariff) {
    if (!/^\d{8}$/.test(t.cth)) problems.push(`tariff ${t.cth}: not an 8-digit code`);
    if (cths.has(t.cth)) problems.push(`tariff ${t.cth}: two rows`);
    cths.add(t.cth);
    dated(`tariff ${t.cth}`, t.valid_from, t.valid_to);
  }

  const keys = new Set<string>();
  const byDutyType: Record<string, number> = {};
  const bcdVersions = new Map<string, NotificationEntryRow[]>();
  let datedByNotification = 0;
  for (const e of entries) {
    if (keys.has(e.entry_key)) problems.push(`entry ${e.entry_key}: duplicate key`);
    keys.add(e.entry_key);
    byDutyType[e.duty_type] = (byDutyType[e.duty_type] ?? 0) + 1;
    if (e.extra.dateSource === 'notification') datedByNotification++;
    dated(`entry ${e.entry_key}`, e.valid_from, e.valid_to);
    if (e.duty_type === 'BCD' && !e.scheme) {
      const k = `${e.table_no}/${e.serial}/${e.sub_entry}`;
      bcdVersions.set(k, [...(bcdVersions.get(k) ?? []), e]);
    }
  }
  for (const [k, versions] of bcdVersions) {
    const sorted = [...versions].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      if (prev.valid_to === null || prev.valid_to >= sorted[i]!.valid_from)
        problems.push(`45/2025 ${k}: versions from ${prev.valid_from} and ${sorted[i]!.valid_from} overlap`);
    }
  }

  const conditionKeys = new Set<string>();
  for (const c of conditions) {
    const k = `${c.notification}/${c.table_no}/${c.condition_no}`;
    if (conditionKeys.has(k)) problems.push(`condition ${k}: duplicate`);
    conditionKeys.add(k);
  }

  return {
    tariffLines: tariff.length,
    notificationEntries: entries.length,
    conditions: conditions.length,
    byDutyType,
    datedByNotification,
    problems,
  };
}
