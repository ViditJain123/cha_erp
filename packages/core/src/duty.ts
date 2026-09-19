import { Decimal } from 'decimal.js';
import type {
  ExchangeRateTable,
  ExemptionClaim,
  InvoiceInput,
  ItemDutyResult,
  ItemInput,
  JobDutyResult,
  MoneyAmount,
  TradeRemedyInput,
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
    // A fixed tariff value displaces the transaction value outright — price,
    // freight, insurance and all (Customs Act s.14(2)).
    const avRaw = item.tariffValue
      ? D(item.tariffValue.amountPerUnit)
          .mul(item.tariffValue.quantity)
          .mul(rateFor(rates, item.tariffValue.currency))
      : value.mul(invRate).plus(additions.mul(share));
    return { item, avRaw };
  });
  const totalAvRaw = items.reduce((a, v) => a.plus(v.avRaw), D(0));
  return { totalAvRaw, items };
}

interface ItemDutyRaw {
  result: ItemDutyResult;
  raw: {
    bcd: Decimal;
    aidc: Decimal;
    healthCess: Decimal;
    sws: Decimal;
    igst: Decimal;
    compCess: Decimal;
    antiDumping: Decimal;
    safeguard: Decimal;
    cvd: Decimal;
  };
}

/**
 * One trade-remedy line. The ad valorem part is on assessable value for
 * anti-dumping and safeguard duty and on landed value (AV + BCD) for CVD; the
 * specific part is amount × quantity at the customs rate; the flag joins them.
 */
function tradeRemedyDuty(
  line: TradeRemedyInput,
  avRaw: Decimal,
  bcd: Decimal,
  rates: ExchangeRateTable,
): Decimal {
  const base = line.basis === 'LANDED' ? avRaw.plus(bcd) : avRaw;
  const adValorem = base.mul(pct(line.ratePercent ?? 0));
  const specific =
    line.amountPerUnit !== undefined && line.quantity !== undefined
      ? D(line.amountPerUnit).mul(line.quantity).mul(rateFor(rates, line.currency ?? 'INR'))
      : D(0);
  switch (line.flag ?? '+') {
    case '+':
      return adValorem.plus(specific);
    case '-':
      return Decimal.max(0, adValorem.minus(specific));
    case 'H':
      return Decimal.max(adValorem, specific);
    case 'L':
      return Decimal.min(adValorem, specific);
  }
}

/**
 * Duty cascade per item, computed on unrounded values (matches Logi-Sys/ICES
 * to the paisa) and rounded to 2dp only for display:
 *   BCD  = AV × bcdRate × (1 − exemption)
 *   AIDC = AV × aidcRate            (SWS-exempt, so not in the SWS base)
 *   SWS  = BCD × swsRate (default 10%)
 *   ADD / safeguard / CVD = per tradeRemedyDuty (not in the SWS base)
 *   IGST = (AV + BCD + AIDC + health cess + SWS + ADD + safeguard + CVD) × igstRate
 *          × (1 - igstExemption%)
 */
function computeItemDuty(v: ItemValuation, rates: ExchangeRateTable): ItemDutyRaw {
  const { item, avRaw } = v;
  const exemptionFactor = item.bcdExemption
    ? D(1).minus(pct(item.bcdExemption.percent))
    : D(1);
  // An exemption on the levy itself, not on the base: 021/2023-Cus (Advance
  // Authorisation) and 026/2023-Cus (EPCG) exempt IGST outright, 025/2023-Cus
  // (DFIA) does not. The IGST *base* still includes the BCD that was itself
  // exempted to nil — section 3(8A) CTA values the goods at the duties
  // actually levied, and a nil BCD is nil in the base.
  const igstFactor = item.igstExemption ? D(1).minus(pct(item.igstExemption.percent)) : D(1);
  const compCessFactor = item.compCessExemption
    ? D(1).minus(pct(item.compCessExemption.percent))
    : D(1);

  const bcd = avRaw.mul(pct(item.bcdRate)).mul(exemptionFactor);
  const aidc = avRaw.mul(pct(item.aidcRate ?? 0));
  const healthCess = avRaw.mul(pct(item.healthCessRate ?? 0));
  const sws = bcd.mul(pct(item.swsRate ?? 10));
  // A scheme's relief is *foregone* duty, not a rate: it stays chargeable
  // under section 12 and so stays in the IGST base (section 3(8) CTA). An
  // ordinary exemption sets the effective rate and the reduced duty is what
  // goes in the base. See `ExemptionClaim.kind`.
  const foregoneInIgstBase =
    item.bcdExemption?.kind === 'scheme'
      ? avRaw.mul(pct(item.bcdRate)).minus(bcd).mul(D(1).plus(pct(item.swsRate ?? 10)))
      : D(0);
  const remedy = (kind: TradeRemedyInput['kind']) =>
    (item.tradeRemedies ?? [])
      .filter((l) => l.kind === kind)
      .reduce((a, l) => a.plus(tradeRemedyDuty(l, avRaw, bcd, rates)), D(0));
  const antiDumping = remedy('ADD');
  const safeguard = remedy('SAFEGUARD');
  const cvd = remedy('CVD');
  // Section 3(8A)/(8) CTA: the IGST value includes every customs duty levied,
  // trade remedies among them.
  const igstBase = avRaw
    .plus(bcd)
    .plus(foregoneInIgstBase)
    .plus(aidc)
    .plus(healthCess)
    .plus(sws)
    .plus(antiDumping)
    .plus(safeguard)
    .plus(cvd);
  const igst = igstBase.mul(pct(item.igstRate)).mul(igstFactor);
  const compCess = igstBase.mul(pct(item.compCessRate ?? 0)).mul(compCessFactor);

  const rounded = {
    bcd: round2(bcd),
    aidc: round2(aidc),
    healthCess: round2(healthCess),
    sws: round2(sws),
    igst: round2(igst),
    compCess: round2(compCess),
    antiDumping: round2(antiDumping),
    safeguard: round2(safeguard),
    cvd: round2(cvd),
  };
  const totalDuty = round2(
    D(rounded.bcd)
      .plus(rounded.aidc)
      .plus(rounded.healthCess)
      .plus(rounded.sws)
      .plus(rounded.igst)
      .plus(rounded.compCess)
      .plus(rounded.antiDumping)
      .plus(rounded.safeguard)
      .plus(rounded.cvd),
  );

  return {
    result: {
      slNo: item.slNo,
      assessableValue: round2(avRaw),
      ...rounded,
      totalDuty,
      effectiveBcdRate: D(item.bcdRate).mul(exemptionFactor).toNumber(),
    },
    raw: { bcd, aidc, healthCess, sws, igst, compCess, antiDumping, safeguard, cvd },
  };
}

/** Compute the full BE duty summary for one invoice at the given customs exchange rates. */
export function computeJobDuty(invoice: InvoiceInput, rates: ExchangeRateTable): JobDutyResult {
  return computeBeDuty([invoice], rates);
}

/**
 * The duty summary for a whole Bill of Entry — every invoice on it.
 *
 * Valuation is per invoice, because each one has its own currency, terms and
 * charges: `ex_job5` files twelve invoices at two exchange rates, and a single
 * total would have to pick one of them. The duty is then the sum, and the two
 * figures that are not sums — the IGST assessable value and the rounded duty
 * payable — are recomputed from the totals rather than added up, so a BE with
 * twelve invoices rounds once, exactly as one with a single invoice does.
 */
export function computeBeDuty(invoices: InvoiceInput[], rates: ExchangeRateTable): JobDutyResult {
  let totalAvRaw = D(0);
  const items: ItemValuation[] = [];
  for (const invoice of invoices) {
    const valued = computeValuation(invoice, rates);
    totalAvRaw = totalAvRaw.plus(valued.totalAvRaw);
    items.push(...valued.items);
  }
  const computed = items.map((v) => computeItemDuty(v, rates));

  const sumRaw = (pick: (r: ItemDutyRaw) => Decimal) =>
    computed.reduce((a, c) => a.plus(pick(c)), D(0));

  const bcd = sumRaw((c) => c.raw.bcd);
  const aidc = sumRaw((c) => c.raw.aidc);
  const healthCess = sumRaw((c) => c.raw.healthCess);
  const sws = sumRaw((c) => c.raw.sws);
  const igst = sumRaw((c) => c.raw.igst);
  const compCess = sumRaw((c) => c.raw.compCess);
  const antiDumping = sumRaw((c) => c.raw.antiDumping);
  const safeguard = sumRaw((c) => c.raw.safeguard);
  const cvd = sumRaw((c) => c.raw.cvd);
  const remedies = antiDumping.plus(safeguard).plus(cvd);

  const igstAssessableValue = round0(
    totalAvRaw.plus(bcd).plus(aidc).plus(healthCess).plus(sws).plus(remedies),
  );
  const dutyPayable = round0(
    bcd.plus(aidc).plus(healthCess).plus(sws).plus(igst).plus(compCess).plus(remedies),
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
      antiDumping: round2(antiDumping),
      safeguard: round2(safeguard),
      cvd: round2(cvd),
    },
    igstAssessableValue,
    dutyPayable,
    dutyPayableInWords: rupeesInWords(dutyPayable),
  };
}

/**
 * Duty foregone per item under one notification — the figure a licence is
 * debited by, `LICENSE.DebitDeutyValue`.
 *
 * Computed, never read off the licence: it is the difference between the duty
 * this Bill of Entry actually pays and the duty it would pay at tariff rates
 * with that notification's exemptions removed. Removing the BCD exemption also
 * restores the IGST it was suppressing, because section 3(8A) CTA puts the BCD
 * in the IGST base — which is why an Advance Authorisation line debits 27.73%
 * of its assessable value (BCD 7.5 + SWS 0.75 + IGST 18 × 1.0825) and not the
 * 26.25% the three headline rates add up to.
 *
 * Pinned against the vendor's own exports: `ex_job25` (021/2023-Cus) and
 * `ex_job26` (026/2023-Cus) debit 27.73%, `ex_job28` (025/2023-Cus, DFIA — no
 * IGST exemption) debits 8.25%, `ex_job20` (RoDTEP scrips) 5.00%.
 *
 * Returns one figure per item, in the order `computeBeDuty` returns them, so
 * the two lists zip. An item `claimed` says nothing about gets `0`.
 *
 * @param claimed the notification whose exemptions to price, per item — the
 *   scheme's `Exim_Notn`. Exemptions claimed under any *other* notification
 *   (an FTA concession, say) stay in place, so they are not debited twice.
 */
export function computeDutyForegone(
  invoices: InvoiceInput[],
  rates: ExchangeRateTable,
  claimed: (item: ItemInput) => string | undefined,
): number[] {
  const strip = (item: ItemInput): ItemInput => {
    const notification = claimed(item);
    if (!notification) return item;
    const out = { ...item };
    // `exactOptionalPropertyTypes` is on, so an exemption is removed by
    // deleting the key — assigning `undefined` is a different type.
    const drop = (key: 'bcdExemption' | 'igstExemption' | 'compCessExemption') => {
      const claim: ExemptionClaim | undefined = out[key];
      if (claim?.notification === notification) delete out[key];
    };
    drop('bcdExemption');
    drop('igstExemption');
    drop('compCessExemption');
    return out;
  };

  const filed = computeBeDuty(invoices, rates);
  const gross = computeBeDuty(
    invoices.map((inv) => ({ ...inv, items: inv.items.map(strip) })),
    rates,
  );
  return filed.items.map((f, i) => {
    const g = gross.items[i];
    return g ? round2(D(g.totalDuty).minus(f.totalDuty)) : 0;
  });
}
