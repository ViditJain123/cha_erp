import {
  END_USE_CODES,
  aidcLevyFor,
  compCessExemptionCandidates,
  compCessForCth,
  igstRateForCth,
  lookupTariff,
  endUseCodeFromText,
  ftaAgreementForCertificate,
  ftaAgreementsForOrigin,
  ftaConcessionFor,
  ftaOriginCriterion,
  ftaSchedule,
  healthCessFor,
  igstExemptionCandidates,
  iso2,
  lookupFtaScheme,
  pad8,
  retroactiveCheck,
  swsExemptionFor,
  tariffValueCandidates,
  tariffValueQuantity,
  tradeRemediesFor,
  type FtaAgreement,
  type TradeRemedyEntry,
} from '@checklist/core';
import type {
  ChecklistDraft,
  DraftCertificateOfOrigin,
  DraftFlag,
  DraftItem,
  FtaOpportunity,
  ItemFtaClaim,
  TradeRemedyLine,
} from './draft.js';

/**
 * The master-derived half of the ITEMS sheet (docs/boe-mapping/06-items.md).
 *
 * The merge reads what the documents say about each line. What the duty
 * masters say depends on the line's CTH, and the CTH is not final until the
 * classification, library and notification steps — and, on the ERP, the
 * importer's product master and the operator — have had their turn. So this
 * runs at the end of the merge and again whenever a CTH may have moved, and
 * it must give the same answer every time it runs over the same draft.
 *
 * It owns the flags it raises (paths `items.N.<field>` for the fields in
 * `OWNED_FIELDS`) and clears them before raising them again, so re-running it
 * never piles up duplicates. It never overwrites a field the operator decided
 * (`item.sources[field] === 'operator'`).
 */

export interface ResolveItemsOptions {
  /** The Bill of Entry date: every master here is date-bound. */
  today: string;
  /** What the mail thread says the goods are for, verbatim. */
  mailEndUse?: string | null;
  /** The importer's answer to "do we take the preferential rate?" */
  claimFtaBenefit?: boolean | null;
  /** The importer's standing end use (organizations.default_end_use_code). */
  defaultEndUseCode?: string | null;
}

/** Flag paths this module raises, as `items.N.<field>`. */
const OWNED_FIELDS = [
  'aidc',
  'sws',
  'healthCess',
  'igstExemption',
  'compCessExemption',
  'fta',
  'tradeRemedies',
  'tariffValue',
  'endUseCode',
  'brand',
  'manufacturer',
  'classification',
] as const;

const ownedPath = /^items\.\d+\.(aidc|sws|healthCess|igstExemption|compCessExemption|fta|tradeRemedies|tariffValue|endUseCode|brand|manufacturer|classification)$/;

const isOperator = (item: DraftItem, field: keyof NonNullable<DraftItem['sources']>) =>
  item.sources?.[field] === 'operator';

/* ------------------------------------------------------------------ *
 * Units
 * ------------------------------------------------------------------ */

const GRAMS_PER: Record<string, number> = {
  GMS: 1,
  G: 1,
  GRAM: 1,
  KGS: 1000,
  KG: 1000,
  KGM: 1000,
  MTS: 1_000_000,
  MT: 1_000_000,
  TNE: 1_000_000,
  TON: 1_000_000,
  TONNE: 1_000_000,
  QTL: 100_000,
};

/** A quantity converted between mass units; undefined when either is not a mass. */
function convertMass(quantity: number, from: string, to: string): number | undefined {
  const norm = (u: string) => u.toUpperCase().replace(/[^A-Z]/g, '').replace(/^METRICTON(NE)?S?$/, 'MT').replace(/^PERMETRICTONNE$/, 'MT');
  const a = GRAMS_PER[norm(from)];
  const b = GRAMS_PER[norm(to)];
  if (a === undefined || b === undefined) return from.toUpperCase() === to.toUpperCase() ? quantity : undefined;
  return (quantity * a) / b;
}

/* ------------------------------------------------------------------ *
 * Certificates of origin
 * ------------------------------------------------------------------ */

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * The certificate — and the line on it — that covers an item.
 *
 * A certificate line covers the item when their HS codes agree to six digits,
 * or when the description on one contains the other's leading words. A job
 * with one certificate that lists one line covers every item on it: that is
 * the ordinary single-product consignment, and certificates routinely print
 * the goods more briefly than the invoice.
 */
function certificateFor(
  item: DraftItem,
  certs: DraftCertificateOfOrigin[],
): { cert: DraftCertificateOfOrigin; line?: DraftCertificateOfOrigin['items'][number] } | undefined {
  const hs6 = digits(item.ritc).slice(0, 6);
  const desc = item.description.toUpperCase();
  for (const cert of certs) {
    const line = cert.items.find((l) => {
      const lh = digits(l.hsCode).slice(0, 6);
      if (lh.length === 6 && lh === hs6) return true;
      const head = l.description.toUpperCase().split(/\s+/).slice(0, 3).join(' ');
      return head.length >= 5 && (desc.includes(head) || l.description.toUpperCase().includes(desc.split(/\s+/).slice(0, 3).join(' ')));
    });
    if (line) return { cert, line };
  }
  if (certs.length === 1 && certs[0]!.items.length <= 1) {
    const cert = certs[0]!;
    return cert.items[0] ? { cert, line: cert.items[0] } : { cert };
  }
  return undefined;
}

/**
 * A concession from the legacy two-scheme table, for an agreement whose
 * schedule has not been parsed. Only DFTP qualifies: its single serial covers
 * every product on the LDC list, so the serial does not depend on the CTH. The
 * Japan CEPA entry there was one job's serial and is deliberately not used.
 */
function legacyConcession(agreement: FtaAgreement, cert: DraftCertificateOfOrigin, origin: string) {
  const legacy = lookupFtaScheme(cert.schemeText ?? '', origin);
  if (!legacy || legacy.scheme !== 'DFTP') return undefined;
  if (!agreement.concessionNotifications.some((n) => n.notification.includes('96/2008') || n.notification.includes('096/2008'))) {
    return undefined;
  }
  return { notification: legacy.notification, serial: legacy.serial, percent: legacy.bcdExemptionPercent };
}

/* ------------------------------------------------------------------ *
 * The resolver
 * ------------------------------------------------------------------ */

export function resolveItems(draft: ChecklistDraft, opts: ResolveItemsOptions): ChecklistDraft {
  const { today } = opts;
  const flags: DraftFlag[] = draft.flags.filter((f) => !(f.path && ownedPath.test(f.path)));
  const certs = draft.certificatesOfOrigin ?? [];
  const opportunities: FtaOpportunity[] = [];
  const shipmentDate = draft.shipment.blDate;
  const mailEndUseCode = endUseCodeFromText(opts.mailEndUse);

  const items = draft.items.map((original, idx): DraftItem => {
    const item: DraftItem = { ...original, sources: { ...original.sources } };
    const at = (field: (typeof OWNED_FIELDS)[number]) => `items.${idx}.${field}`;
    const cth = pad8(item.ritc);
    const label = `Item ${item.invoiceSrNo}/${item.slNo}`;

    // ---- End use ----
    if (!isOperator(item, 'endUseCode')) {
      if (mailEndUseCode && END_USE_CODES[mailEndUseCode]) {
        item.endUseCode = mailEndUseCode;
        item.sources!.endUseCode = 'mail';
      } else if (item.sources?.endUseCode !== 'master') {
        const standing = opts.defaultEndUseCode && END_USE_CODES[opts.defaultEndUseCode] ? opts.defaultEndUseCode : undefined;
        if (standing) {
          item.endUseCode = standing;
          item.sources!.endUseCode = 'master';
        }
      }
    }
    if (!item.endUseCode || !END_USE_CODES[item.endUseCode]) {
      flags.push({
        severity: 'warning',
        path: at('endUseCode'),
        message: `${label}: no end use — the importer has given no instruction and has no default. Choose one (GNX100 trading, GNX200 manufacture/actual use).`,
      });
    }

    // ---- Brand ----
    if (item.sources?.brand === 'default') {
      flags.push({
        severity: 'warning',
        path: at('brand'),
        message: `${label}: the invoice prints no brand; filed as UNBRANDED. Confirm, or enter the brand.`,
      });
    }

    // ---- Classification confirmation ----
    if (item.sources?.ritc && item.sources.ritc !== 'master' && item.sources.ritc !== 'operator') {
      flags.push({
        severity: 'error',
        path: at('classification'),
        message: `${label}: "${item.description.slice(0, 60)}" is new for this importer — confirm CTH ${item.ritc || '(none)'} and the item details once; they are remembered from then on.`,
      });
    }

    if (!cth) return item;

    // ---- SWS exemption ----
    const sws = swsExemptionFor(cth, today);
    if (sws && !sws.conditional && !sws.rivals.length) {
      item.swsExemption = { notification: sws.notification, serial: sws.serial, flag: sws.flag };
      if (sws.rate !== null) item.swsRate = sws.rate;
    } else {
      delete item.swsExemption;
      if (sws) {
        flags.push({
          severity: 'info',
          path: at('sws'),
          message: `${label}: SWS exemption ${sws.notification} S.No. ${sws.serial} may apply to CTH ${cth}${sws.conditional ? ' subject to its conditions' : ''} — not applied.`,
        });
      }
    }

    // ---- Health cess ----
    const hc = healthCessFor(cth, today);
    if (hc && !hc.conditional && !hc.rivals.length) {
      item.healthCess = { notification: hc.notification, serial: hc.serial, flag: hc.flag };
      if (hc.rate !== null) item.healthCessRate = hc.rate;
    }

    // ---- IGST / compensation cess ----
    if (item.igstNotification) item.igstLevyFlag = '+';
    if (item.compCessNotification) item.compCessLevyFlag = '+';
    for (const [field, candidates] of [
      ['igstExemption', igstExemptionCandidates(cth, today)],
      ['compCessExemption', compCessExemptionCandidates(cth, today)],
    ] as const) {
      if (item[field] && item.sources?.fta === 'operator') continue;
      if (!candidates.length) continue;
      flags.push({
        severity: 'info',
        path: at(field),
        message:
          `${label}: ${field === 'igstExemption' ? 'IGST' : 'compensation cess'} exemption may apply to CTH ${cth}: ` +
          candidates
            .slice(0, 3)
            .map((c) => `${c.notification} S.No. ${c.serial} (${c.type === 'C' ? 'Customs' : 'GST'} notn.) "${c.description.slice(0, 50)}"`)
            .join('; ') +
          ' — applies only if the goods match the description and conditions.',
      });
    }

    // ---- Preferential origin ----
    if (!isOperator(item, 'fta')) {
      delete item.fta;
      // A preferential exemption is only ever this block's own output (the
      // 45/2025 step sets bcdNotification, never a scheme), so a stale one
      // from a CTH that has since changed goes with the claim.
      if (item.bcdExemption?.scheme) delete item.bcdExemption;
      const covering = certificateFor(item, certs);
      const origin = iso2(item.originCountry ?? covering?.cert.originCountry ?? covering?.cert.issuingCountry);

      if (covering && origin && opts.claimFtaBenefit !== false) {
        const { cert, line } = covering;
        const agreement = ftaAgreementForCertificate(cert.schemeText, origin, today);
        if (!agreement) {
          flags.push({
            severity: 'warning',
            path: at('fta'),
            message: `${label}: certificate of origin ${cert.certificateNumber} ("${(cert.schemeText ?? '').slice(0, 60)}") matches no trade agreement in force with ${origin} on ${today} — no preferential rate claimed.`,
          });
        } else {
          const concession = ftaConcessionFor(agreement, cth, today);
          const legacy = !concession && ftaSchedule(agreement.key) === null ? legacyConcession(agreement, cert, origin) : undefined;
          if (!concession && !legacy) {
            flags.push({
              severity: 'warning',
              path: at('fta'),
              message:
                ftaSchedule(agreement.key) === null
                  ? `${label}: ${agreement.name}'s concession schedule is not in the masters — enter the notification serial for CTH ${cth} by hand.`
                  : `${label}: CTH ${cth} is not a concession line under ${agreement.name} — no preferential rate claimed.`,
            });
          } else {
            const notification = concession?.notification ?? legacy!.notification;
            const serial = concession?.serial ?? legacy!.serial;
            const invoiceDate = (draft.invoices ?? []).find((i) => i.srNo === item.invoiceSrNo)?.invoiceDate;
            const retro = retroactiveCheck(agreement, cert.issueDate, shipmentDate, cert.issuedRetroactively, invoiceDate);
            const coded = ftaOriginCriterion(agreement, line?.originCriterion ?? cert.originCriterion);
            const criterion = coded?.criterion;
            const transit = cert.transitCountries.map((c) => iso2(c)).find(Boolean);
            const slot = concession?.slot ?? agreement.slot;
            const claim: ItemFtaClaim = {
              agreement: agreement.key,
              scheme: agreement.name,
              slot,
              notification,
              serial,
              cooNumber: cert.certificateNumber,
              ...(cert.issueDate && { cooDate: cert.issueDate }),
              ...(iso2(cert.issuingCountry) && { countryOfIssue: iso2(cert.issuingCountry)! }),
              ...(criterion && { originCriterion: criterion }),
              ...(coded?.tariffShift && { tariffShift: coded.tariffShift }),
              ...(!criterion && (line?.originCriterion ?? cert.originCriterion) && {
                originCriterionRemarks: (line?.originCriterion ?? cert.originCriterion)!,
              }),
              directConsignment: !transit,
              retroactiveIssuance: retro.retroactive,
              ...(line?.itemNumber && { itemSrNoInCertificate: line.itemNumber }),
              retroactiveCheck: { compliant: retro.compliant, reason: retro.reason },
            };
            item.fta = claim;
            item.transitCountry = transit ?? origin;
            item.sources!.fta = 'document';

            // The duty engine's view: a BASIC-slot rate is the preferential
            // BCD itself; a SAPTA-slot rate is the percentage of duty remitted.
            const percent = legacy
              ? legacy.percent
              : concession!.rateIsRemission
                ? (concession!.rate ?? 0)
                : concession!.rate !== null && item.bcdRate > 0
                  ? Math.max(0, Math.min(100, (1 - concession!.rate / item.bcdRate) * 100))
                  : concession!.rate === 0
                    ? 100
                    : 0;
            item.bcdExemption = { notification, serial, percent, scheme: agreement.name };

            if (!retro.compliant) {
              flags.push({ severity: 'error', path: at('fta'), message: `${label}: ${retro.reason}` });
            } else {
              flags.push({
                severity: 'info',
                path: at('fta'),
                message: `${label}: ${agreement.name} claimed — ${notification} S.No. ${serial}${concession?.rateText ? ` at ${concession.rateText}` : ''}. ${retro.reason}`,
              });
            }
            if (concession?.rivals.length) {
              flags.push({
                severity: 'warning',
                path: at('fta'),
                message: `${label}: ${agreement.name} S.No. ${[serial, ...concession.rivals].join(' / ')} all name CTH ${cth} — confirm which describes the goods.`,
              });
            }
          }
        }
      } else if (covering && opts.claimFtaBenefit === false) {
        flags.push({
          severity: 'info',
          path: at('fta'),
          message: `${label}: the importer asked not to claim the preferential rate — certificate ${covering.cert.certificateNumber} not used.`,
        });
      } else if (!covering && origin && opts.claimFtaBenefit !== false) {
        // No certificate. If the origin is a partner and the schedule names
        // the CTH, the benefit is being left on the table: ask the importer.
        for (const agreement of ftaAgreementsForOrigin(origin, today)) {
          const concession = ftaConcessionFor(agreement, cth, today);
          if (!concession) continue;
          if (item.bcdExemption?.scheme === agreement.name) delete item.bcdExemption;
          const prefRate = concession.rateIsRemission
            ? concession.rate !== null
              ? item.bcdRate * (1 - concession.rate / 100)
              : null
            : concession.rate;
          const rate = draft.invoiceMeta?.exchangeRates?.[(draft.invoices ?? []).find((i) => i.srNo === item.invoiceSrNo)?.currency ?? ''] ?? 1;
          const av = item.amount * rate;
          const saving =
            prefRate !== null && item.bcdRate > prefRate ? Math.round(av * ((item.bcdRate - prefRate) / 100) * 1.1) : undefined;
          opportunities.push({
            invoiceSrNo: item.invoiceSrNo,
            itemSlNo: item.slNo,
            agreement: agreement.key,
            agreementName: agreement.name,
            notification: concession.notification,
            serial: concession.serial,
            standardBcdRate: item.bcdRate,
            preferentialRateText: concession.rateText,
            ...(saving !== undefined && { estimatedSaving: saving }),
          });
          flags.push({
            severity: 'warning',
            path: at('fta'),
            message:
              `${label}: origin ${origin} qualifies under ${agreement.name} (${concession.notification} S.No. ${concession.serial}` +
              `${concession.rateText ? `, ${concession.rateText}` : ''}) but there is no certificate of origin` +
              `${saving !== undefined ? ` — about ₹${saving.toLocaleString('en-IN')} of duty` : ''}. Ask the importer whether to take the benefit.`,
          });
          break;
        }
      }
    }

    // ---- AIDC ----
    // Resolved after the preferential claim, because the serial follows the
    // BCD exemption claimed on the line (S.No. 19 for 69/2011, 17 otherwise).
    const bcdClaim =
      item.bcdExemption ??
      (item.bcdNotification
        ? { notification: item.bcdNotification, ...(item.notificationSerials?.basic && { serial: item.notificationSerials.basic }) }
        : undefined);
    const aidc = aidcLevyFor(cth, today, bcdClaim);

    if (aidc) {
      item.aidcNotification = aidc.notification;
      if (aidc.rivals.length) {
        delete item.aidcLevy;
        flags.push({
          severity: 'warning',
          path: at('aidc'),
          message: `${label}: AIDC ${aidc.notification} S.No. ${[aidc.serial, ...aidc.rivals].join(' / ')} all name CTH ${cth} — the description decides the serial.`,
        });
      } else {
        item.aidcLevy = { notification: aidc.notification, serial: aidc.serial, flag: aidc.flag };
        if (aidc.rate !== null && !aidc.conditional) item.aidcRate = aidc.rate;
      }
    }

    // ---- Trade remedies ----
    //
    // A chosen row answers the question, so the question goes away with it. It
    // did not: the candidate list is only cleared on the branch that rebuilds
    // it, so an operator who picked the row kept the candidates that prompted
    // them, and the export went on refusing to file — "1 trade-remedy row may
    // apply and none is chosen" against a line where one had been.
    if (isOperator(item, 'tradeRemedies')) {
      delete item.tradeRemedyCandidates;
    }
    if (!isOperator(item, 'tradeRemedies')) {
      delete item.tradeRemedies;
      delete item.tradeRemedyCandidates;
      const origin = iso2(item.originCountry);
      const matches = tradeRemediesFor({
        cth,
        originIso2: origin,
        exportIso2: iso2(draft.shipment.consCountry) ?? origin,
        producer: item.manufacturerName,
        exporter: draft.supplier.name,
        onIsoDate: today,
      });
      const lines: TradeRemedyLine[] = [];
      const open: NonNullable<DraftItem['tradeRemedyCandidates']> = [];
      for (const kind of ['ADD', 'SAFEGUARD', 'CVD'] as const) {
        const m = matches[kind];
        if (m.entry && m.entry.basis === 'REFERENCE_PRICE') {
          // The duty is the shortfall of the landed value below a reference
          // price. That needs the landed value per unit, which is the officer's
          // arithmetic on the final assessment — so it is flagged, not guessed.
          const e = m.entry;
          flags.push({
            severity: 'error',
            path: at('tradeRemedies'),
            message:
              `${label}: ${kind} ${e.notificationShort ?? e.notification} row ${e.tableSerial ?? '?'} is a reference-price duty — ` +
              `the difference between the landed value and ${e.currency ?? ''} ${e.amount} per ${e.unit}. Work it out and enter it on the item.`,
          });
          open.push({
            kind,
            notification: e.notificationShort ?? e.notification,
            ...(e.tableSerial && { cthSerial: e.tableSerial }),
            producer: e.producer,
            exporter: e.exporter,
          });
        } else if (m.entry) {
          const line = remedyLine(m.entry, item);
          if (m.entry.dutyNotes?.length || m.entry.notLeviedAtOrAboveCifPrice?.length) {
            flags.push({
              severity: 'warning',
              path: at('tradeRemedies'),
              message:
                `${label}: ${kind} ${m.entry.notificationShort ?? m.entry.notification} carries conditions the rate does not — ` +
                [...(m.entry.dutyNotes ?? []), ...(m.entry.notLeviedAtOrAboveCifPrice ?? []).map((c) => `not levied at or above CIF ${c.currency} ${c.cifPrice}/${c.unit} for ${c.productCategory}`)]
                  .slice(0, 3)
                  .join('; ') +
                '.',
            });
          }
          if (line) lines.push(line);
          else
            flags.push({
              severity: 'error',
              path: at('tradeRemedies'),
              message: `${label}: ${kind} ${m.entry.notification} is ${m.entry.amount} ${m.entry.currency ?? ''} per ${m.entry.unit}, and the quantity in ${item.unit} cannot be converted — enter ADD_Qty by hand.`,
            });
        } else if (m.candidates.length) {
          open.push(
            ...m.candidates.map((e) => {
              const line = e.basis === 'REFERENCE_PRICE' ? undefined : remedyLine(e, item);
              return {
                kind,
                notification: e.notificationShort ?? e.notification,
                ...(e.tableSerial && { cthSerial: e.tableSerial }),
                ...(e.supplierSerial && { supplierSerial: e.supplierSerial }),
                producer: e.producer,
                exporter: e.exporter,
                ...(line && { line }),
              };
            }),
          );
          flags.push({
            severity: 'error',
            path: at('tradeRemedies'),
            message:
              `${label}: ${kind === 'ADD' ? 'anti-dumping duty' : kind === 'CVD' ? 'countervailing duty' : 'safeguard duty'} may apply to CTH ${cth} from ${origin ?? 'this origin'} — ` +
              m.candidates
                .slice(0, 4)
                .map((e) => `${e.notificationShort ?? e.notification} row ${e.tableSerial ?? '?'} (producer ${e.producer}, exporter ${e.exporter})`)
                .join('; ') +
              '. Pick the row for this producer and exporter.',
          });
        }
      }
      if (lines.length) {
        item.tradeRemedies = lines;
        flags.push({
          severity: 'warning',
          path: at('tradeRemedies'),
          message: `${label}: ${lines.map((l) => `${l.kind} ${l.notification}${l.cthSerial ? ` row ${l.cthSerial}` : ''}`).join(', ')} applied to CTH ${cth} — confirm the producer and exporter.`,
        });
      }
      if (open.length) item.tradeRemedyCandidates = open;
    }

    // ---- Tariff value ----
    delete item.tariffValue;
    const tv = tariffValueCandidates(cth, today);
    if (tv) {
      const row =
        tv.rows.length === 1
          ? tv.rows[0]
          : tv.rows.find((r) => item.description.toUpperCase().includes(r.description.toUpperCase().split(/[\s(,]+/)[0] ?? ' '));
      if (!row) {
        flags.push({
          severity: 'error',
          path: at('tariffValue'),
          message: `${label}: CTH ${cth} carries a tariff value under ${tv.edition.notification} — ${tv.rows.map((r) => `S.No. ${r.serial} "${r.description}"`).join(', ')}. Choose the one describing the goods.`,
        });
      } else {
        const q = tariffValueQuantity(item.quantity, item.unit, row);
        if (q === undefined) {
          flags.push({
            severity: 'error',
            path: at('tariffValue'),
            message: `${label}: ${tv.edition.notification} fixes a tariff value of ${row.currency} ${row.amount} ${row.unitText}, and a quantity in ${item.unit} cannot be converted to it.`,
          });
        } else {
          item.tariffValue = {
            notification: tv.baseNotification,
            serial: String(row.serial),
            quantity: Math.round(q * 1000) / 1000,
            currency: row.currency,
            amountPerUnit: row.amount,
            unit: row.uqc,
          };
          flags.push({
            severity: 'info',
            path: at('tariffValue'),
            message: `${label}: tariff value ${row.currency} ${row.amount} ${row.unitText} (${tv.edition.notification}, in force from ${tv.edition.effectiveFrom}) — duty is on the tariff value, not the invoice price.`,
          });
        }
      }
    }

    return item;
  });

  const firstClaim = items.find((i) => i.fta)?.fta;
  const { ftaClaim: _staleClaim, ftaOpportunities: _staleOpps, ...rest } = draft;
  return {
    ...rest,
    items,
    flags,
    ...(opportunities.length && { ftaOpportunities: opportunities }),
    // The draft-wide claim is kept for readers that predate per-item claims
    // (the eval's `ftaScheme`, the legacy job view). It mirrors the first item.
    ...(firstClaim && {
      ftaClaim: {
        scheme: firstClaim.scheme,
        cooNumber: firstClaim.cooNumber ?? '',
        ...(firstClaim.cooDate && { cooDate: firstClaim.cooDate }),
        ...(firstClaim.countryOfIssue && { countryOfIssue: firstClaim.countryOfIssue }),
        ...(firstClaim.originCriterion && { originCriterion: firstClaim.originCriterion }),
        directConsignment: firstClaim.directConsignment ?? true,
        ...(firstClaim.retroactiveIssuance !== undefined && { retroactiveIssuance: firstClaim.retroactiveIssuance }),
      },
    }),
  };
}

/** A trade-remedy row as the item's duty line, or undefined when its unit cannot be reached. */
function remedyLine(e: TradeRemedyEntry, item: DraftItem): TradeRemedyLine | undefined {
  const notification = e.notificationShort ?? e.notification;
  const base: TradeRemedyLine = {
    kind: e.kind,
    notification,
    ...(e.tableSerial && { cthSerial: e.tableSerial }),
    ...(e.supplierSerial && { supplierSerial: e.supplierSerial }),
    basis: e.basis === 'LANDED_PCT' || (e.kind === 'CVD' && e.basis !== 'CIF_PCT' && e.basis !== 'AV') ? 'LANDED' : 'AV',
  };
  if (e.amount !== null && e.unit) {
    const quantity = convertMass(item.quantity, item.unit, e.unit);
    if (quantity === undefined) return undefined;
    return {
      ...base,
      quantity: Math.round(quantity * 1e6) / 1e6,
      amountPerUnit: e.amount,
      amountUnit: e.unit,
      ...(e.currency && { currency: e.currency }),
      ...(e.rate !== null && { ratePercent: e.rate }),
      flag: '+',
    };
  }
  return { ...base, ...(e.rate !== null && { ratePercent: e.rate }) };
}

/**
 * Point an item at a different CTH and re-derive what the CTH alone decides.
 *
 * Used when the product master or the operator overrules the code the
 * documents gave. The tariff rate, the IGST schedule entry and the cess entry
 * all follow the code; a 45/2025 concession chosen for the old code does not
 * survive the change, because its serial named the old goods.
 */
export function retargetItemCth(item: DraftItem, cth: string): DraftItem {
  const code = pad8(cth);
  if (!code || code === pad8(item.ritc)) return { ...item, ...(code && { ritc: code }) };
  const tariff = lookupTariff(code);
  const igst = igstRateForCth(code);
  const cess = compCessForCth(code);
  const serials = { ...item.notificationSerials };
  delete serials.basic;
  delete serials.igst;
  delete serials.compCess;
  if (igst && !igst.residual) serials.igst = `${igst.entry.schedule}${igst.entry.serial}`;
  if (cess && !cess.alternatives.length) serials.compCess = cess.entry.serial;
  const { bcdNotification: _oldConcession, bcdExemption: _oldExemption, ...rest } = item;
  return {
    ...rest,
    ritc: code,
    bcdRate: tariff?.bcdRate ?? 0,
    igstRate: igst?.rate ?? tariff?.igstRate ?? item.igstRate,
    ...(igst && { igstNotification: igst.notification }),
    ...(cess && { compCessNotification: cess.notification }),
    compCessRate: cess && !cess.residual && !cess.alternatives.length ? (cess.rate ?? 0) : (tariff?.compCessRate ?? 0),
    notificationSerials: serials,
  };
}
