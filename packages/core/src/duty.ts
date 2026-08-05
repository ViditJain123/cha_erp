import { Decimal } from 'decimal.js';
import type {
  ExchangeRateTable,
  InvoiceInput,
  ItemDutyResult,
  ItemInput,
  JobDutyResult,
  MoneyAmount,
} from './types.js';
import { rupeesInWords } from './words.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

const D = (n: number | string | Decimal) => new Decimal(n);
const pct = (rate: number) => D(rate).div(100);

function round2(d: Decimal): number {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}
function round0(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

function rateFor(rates: ExchangeRateTable, currency: string): Decimal {
  if (currency === 'INR') return D(1);
  const r = rates[currency];
  if (r === undefined) throw new Error(`no exchange rate for currency ${currency}`);
  return D(r);
}

function toINR(m: MoneyAmount, rates: ExchangeRateTable): Decimal {
  return D(m.amount).mul(rateFor(rates, m.currency));
}

interface ItemValuation {
  item: ItemInput;
  /** Unrounded assessable value share in INR. */
  avRaw: Decimal;
}

/**
 * Assessable value: invoice goods value converted at the CBIC customs rate,
 * plus dutiable additions (freight / insurance / misc / loading, each in its
 * own currency), minus discount. Additions are apportioned to items pro-rata
 * by item value. No notional landing charge (actuals only, per the Customs
 * Valuation Rules as amended in 2017 — confirmed by the reference checklists).
 */
function computeValuation(
  invoice: InvoiceInput,
  rates: ExchangeRateTable,
): { totalAvRaw: Decimal; items: ItemValuation[] } {
  const invRate = rateFor(rates, invoice.currency);

  const itemValues = invoice.items.map((item) => D(item.unitPrice).mul(item.quantity));
  const goodsValue = itemValues.reduce((a, b) => a.plus(b), D(0));
  if (goodsValue.isZero()) throw new Error('invoice goods value is zero');

  let additions = D(0);
  if (invoice.freight) additions = additions.plus(toINR(invoice.freight, rates));
  if (invoice.miscCharges) additions = additions.plus(toINR(invoice.miscCharges, rates));
  if (invoice.loadingCharges) additions = additions.plus(toINR(invoice.loadingCharges, rates));
  if (invoice.discount) additions = additions.minus(toINR(invoice.discount, rates));
  if (invoice.insurance) {
    // Percent-based insurance (marine open policy) applies to the C&F value:
    // goods + freight/misc additions, before insurance itself.
    additions = additions.plus(
      invoice.insurance.kind === 'amount'
        ? toINR(invoice.insurance.value, rates)
        : goodsValue.mul(invRate).plus(additions).mul(pct(invoice.insurance.percent)),
    );
  }

  const items = invoice.items.map((item, i) => {
    const value = itemValues[i]!;
    const share = value.div(goodsValue);
    const avRaw = value.mul(invRate).plus(additions.mul(share));
    return { item, avRaw };
  });
  const totalAvRaw = goodsValue.mul(invRate).plus(additions);
  return { totalAvRaw, items };
}

interface ItemDutyRaw {
  result: ItemDutyResult;
  raw: { bcd: Decimal; aidc: Decimal; healthCess: Decimal; sws: Decimal; igst: Decimal; compCess: Decimal };
}

/**
 * Duty cascade per item, computed on unrounded values (matches Logi-Sys/ICES
 * to the paisa) and rounded to 2dp only for display:
 *   BCD  = AV × bcdRate × (1 − exemption)
 *   AIDC = AV × aidcRate            (SWS-exempt, so not in the SWS base)
 *   SWS  = BCD × swsRate (default 10%)
 *   IGST = (AV + BCD + AIDC + health cess + SWS) × igstRate
 */
function computeItemDuty(v: ItemValuation): ItemDutyRaw {
  const { item, avRaw } = v;
  const exemptionFactor = item.bcdExemption
    ? D(1).minus(pct(item.bcdExemption.percent))
    : D(1);

  const bcd = avRaw.mul(pct(item.bcdRate)).mul(exemptionFactor);
  const aidc = avRaw.mul(pct(item.aidcRate ?? 0));
  const healthCess = avRaw.mul(pct(item.healthCessRate ?? 0));
  const sws = bcd.mul(pct(item.swsRate ?? 10));
  const igstBase = avRaw.plus(bcd).plus(aidc).plus(healthCess).plus(sws);
  const igst = igstBase.mul(pct(item.igstRate));
  const compCess = igstBase.mul(pct(item.compCessRate ?? 0));

  const rounded = {
    bcd: round2(bcd),
    aidc: round2(aidc),
    healthCess: round2(healthCess),
    sws: round2(sws),
    igst: round2(igst),
    compCess: round2(compCess),
  };
  const totalDuty = round2(
    D(rounded.bcd)
      .plus(rounded.aidc)
      .plus(rounded.healthCess)
      .plus(rounded.sws)
      .plus(rounded.igst)
      .plus(rounded.compCess),
  );

  return {
    result: {
      slNo: item.slNo,
      assessableValue: round2(avRaw),
      ...rounded,
      totalDuty,
      effectiveBcdRate: D(item.bcdRate).mul(exemptionFactor).toNumber(),
    },
    raw: { bcd, aidc, healthCess, sws, igst, compCess },
  };
}

/** Compute the full BE duty summary for one invoice at the given customs exchange rates. */
export function computeJobDuty(invoice: InvoiceInput, rates: ExchangeRateTable): JobDutyResult {
  const { totalAvRaw, items } = computeValuation(invoice, rates);
  const computed = items.map(computeItemDuty);

  const sumRaw = (pick: (r: ItemDutyRaw) => Decimal) =>
    computed.reduce((a, c) => a.plus(pick(c)), D(0));

  const bcd = sumRaw((c) => c.raw.bcd);
  const aidc = sumRaw((c) => c.raw.aidc);
  const healthCess = sumRaw((c) => c.raw.healthCess);
  const sws = sumRaw((c) => c.raw.sws);
  const igst = sumRaw((c) => c.raw.igst);
  const compCess = sumRaw((c) => c.raw.compCess);

  const igstAssessableValue = round0(totalAvRaw.plus(bcd).plus(aidc).plus(healthCess).plus(sws));
  const dutyPayable = round0(
    bcd.plus(aidc).plus(healthCess).plus(sws).plus(igst).plus(compCess),
  );

  return {
    totalAssessableValue: round2(totalAvRaw),
    items: computed.map((c) => c.result),
    totals: {
      bcd: round2(bcd),
      aidc: round2(aidc),
      healthCess: round2(healthCess),
      sws: round2(sws),
      igst: round2(igst),
      compCess: round2(compCess),
    },
    igstAssessableValue,
    dutyPayable,
    dutyPayableInWords: rupeesInWords(dutyPayable),
  };
}
