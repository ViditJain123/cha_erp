import {
  applicableDeclarations,
  chaProfile,
  computeJobDuty,
  exchangeRatesOn,
  formatForeignPort,
  lookupForeignPort,
  lookupFtaScheme,
  lookupImporter,
  lookupTariff,
  lookupTariffByPrefix,
  normalizeUqc,
  recallProductMemory,
  singleWindowRuleForChapter,
  validateGstin,
  type TermsOfInvoice,
} from '@checklist/core';
import type {
  AwbExtract,
  BlExtract,
  CoaExtract,
  CooExtract,
  ExtractedDoc,
  InvoiceExtract,
  PackingListExtract,
} from './schemas.js';
import { toInvoiceInput, type ChecklistDraft, type DraftFlag, type DraftItem, type FieldMeta } from './draft.js';

function pick<T>(docs: ExtractedDoc[], type: string): T | undefined {
  const d = docs.find((x) => x.docType === type && x.data);
  return d?.data as T | undefined;
}
function fileOf(docs: ExtractedDoc[], type: string): string | undefined {
  return docs.find((x) => x.docType === type && x.data)?.fileName;
}

function normalizeToi(t: InvoiceExtract['termsOfInvoice']): TermsOfInvoice {
  switch (t) {
    case 'CFR':
      return 'C&F';
    case 'CPT':
    case 'UNKNOWN':
      return 'C&F';
    default:
      return t;
  }
}

const nearlyEqual = (a: number, b: number, tolerance = 0.02) =>
  Math.abs(a - b) <= tolerance * Math.max(a, b);

/**
 * Deterministic merge of per-document extractions into a reviewable checklist
 * draft: reconcile overlapping fields, enrich from masters, compute duty.
 *
 * Source-of-truth rules (from the operator's hand notes):
 *   importer name & port of loading <- BL/AWB; country of origin <- COO;
 *   invoice no/date, TOI, terms of payment, description & HSN <- invoice;
 *   duty/GST/single-window data <- masters.
 */
export function mergeToDraft(docs: ExtractedDoc[], opts?: { today?: string }): ChecklistDraft {
  const flags: DraftFlag[] = [];
  const fieldMeta: Record<string, FieldMeta> = {};
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);

  const inv = pick<InvoiceExtract>(docs, 'invoice');
  const bl = pick<BlExtract>(docs, 'bill_of_lading');
  const awb = pick<AwbExtract>(docs, 'air_waybill');
  const coo = pick<CooExtract>(docs, 'certificate_of_origin');
  const coa = pick<CoaExtract>(docs, 'certificate_of_analysis');
  const pl = pick<PackingListExtract>(docs, 'packing_list');

  if (!inv) flags.push({ severity: 'error', message: 'No commercial invoice found — invoice is mandatory.' });
  if (!bl && !awb)
    flags.push({ severity: 'error', message: 'No transport document (BL/AWB) found — required for BE.' });

  const transportMode: 'Air' | 'Sea' = awb ? 'Air' : 'Sea';
  const customStation = awb
    ? { code: 'INBOM4', name: 'Sahar Air Cargo' }
    : { code: 'INNSA1', name: 'Nhava Sheva Sea' };
  flags.push({
    severity: 'info',
    path: 'customStation',
    message: `Custom station defaulted to ${customStation.name} for ${transportMode} — confirm.`,
  });

  // ---- Importer (consignee on transport doc, enriched from masters) ----
  const consigneeName = bl?.consigneeName ?? awb?.consigneeName ?? inv?.buyerName ?? '';
  const master = consigneeName ? lookupImporter(consigneeName) : undefined;
  if (!master) {
    flags.push({
      severity: 'warning',
      path: 'importer',
      message: `Importer "${consigneeName}" not in importer master — IEC/GSTIN/AD code need manual entry (will be saved for next time).`,
    });
  }
  const importer: ChecklistDraft['importer'] = master
    ? {
        name: master.name,
        addressLines: master.address,
        iec: master.iec,
        pan: master.pan,
        gstin: master.gstin,
        gstStateCode: master.gstStateCode,
        gstStateName: master.gstStateName,
        adCode: master.adCode,
        branchSno: master.branchSno,
        matchedFromMasters: true,
      }
    : { name: consigneeName, addressLines: [], matchedFromMasters: false };
  fieldMeta['importer.name'] = {
    confidence: master ? 'high' : 'medium',
    sources: [fileOf(docs, bl ? 'bill_of_lading' : 'air_waybill') ?? 'unknown'],
  };

  if (importer.gstin) {
    const gstinCheck = validateGstin(importer.gstin, {
      ...(importer.pan && { pan: importer.pan }),
      ...(importer.gstStateCode && { stateCode: importer.gstStateCode }),
    });
    for (const p of gstinCheck.problems) {
      flags.push({ severity: 'warning', path: 'importer.gstin', message: p });
    }
  }

  // ---- Shipment ----
  const grossWeights: { source: string; value: number }[] = [];
  for (const [source, value] of [
    [fileOf(docs, 'bill_of_lading'), bl?.grossWeightKg],
    [fileOf(docs, 'air_waybill'), awb?.grossWeightKg],
    [fileOf(docs, 'invoice'), inv?.grossWeightKg],
    [fileOf(docs, 'packing_list'), pl?.grossWeightKg],
    [fileOf(docs, 'certificate_of_origin'), coo?.grossWeightKg],
  ] as const) {
    if (source && value != null && value > 0) grossWeights.push({ source, value });
  }
  const grossWeightKg = grossWeights[0]?.value;
  const gwConflicts = grossWeights.filter((g) => grossWeightKg != null && !nearlyEqual(g.value, grossWeightKg));
  if (gwConflicts.length) {
    flags.push({
      severity: 'warning',
      path: 'shipment.grossWeightKg',
      message: `Gross weight differs across documents: ${grossWeights.map((g) => `${g.value}kg (${g.source})`).join(', ')}.`,
    });
    fieldMeta['shipment.grossWeightKg'] = {
      confidence: 'low',
      sources: grossWeights.map((g) => g.source),
      conflicts: gwConflicts.map((g) => ({ source: g.source, value: `${g.value} kg` })),
    };
  }

  const shipment: ChecklistDraft['shipment'] = {
    containers: (bl?.containers ?? []).map((c) => ({
      number: c.number,
      ...(c.sizeType != null ? { sizeType: c.sizeType } : {}),
      ...(c.sealNo != null ? { sealNo: c.sealNo } : {}),
    })),
  };
  if (awb?.mawbNumber) shipment.mawbNo = awb.mawbNumber;
  if (awb?.awbDate) shipment.mawbDate = awb.awbDate;
  if (awb?.hawbNumber) {
    shipment.hawbNo = awb.hawbNumber;
    if (awb.awbDate) shipment.hawbDate = awb.awbDate;
  }
  if (bl) {
    shipment.blNo = bl.blNumber;
    if (bl.blDate) shipment.blDate = bl.blDate;
    if (bl.isHouseBl) shipment.hblNo = bl.blNumber;
    if (bl.vesselVoyage) shipment.vesselOrFlight = bl.vesselVoyage;
    if (bl.shippingLine) shipment.shippingLineOrCarrier = bl.shippingLine;
    if (bl.marksAndNumbers) shipment.marksAndNos = bl.marksAndNumbers;
  }
  if (awb?.flightAndDate) shipment.vesselOrFlight = awb.flightAndDate;
  if (awb?.issuingCarrierOrAgent) shipment.shippingLineOrCarrier = awb.issuingCarrierOrAgent;
  const pol = bl?.portOfLoading ?? awb?.airportOfDeparture;
  if (pol) {
    const port = lookupForeignPort(pol);
    if (port) {
      // ICES format "Boston(USBOS)" + consignment country from the port master
      shipment.portOfLoading = formatForeignPort(port);
      shipment.consCountry = port.country;
    } else {
      shipment.portOfLoading = pol;
      const polParts = pol.split(',').map((s) => s.trim()).filter(Boolean);
      const polCountry = polParts.length > 1 ? polParts.at(-1) : undefined;
      if (polCountry && polCountry.length > 2) shipment.consCountry = polCountry;
      flags.push({
        severity: 'info',
        path: 'shipment.portOfLoading',
        message: `Port "${pol}" not in the foreign-ports master — add it to get the UN/LOCODE format and consignment country automatically.`,
      });
    }
  }
  if (coo?.issuingCountry) shipment.countryOfOrigin = coo.issuingCountry;
  const pkgCount = bl?.packageCount ?? awb?.pieces;
  if (pkgCount != null) shipment.packageCount = pkgCount;
  const pkgUnit = bl?.packageUnit ?? (awb ? 'PLT' : undefined);
  if (pkgUnit) shipment.packageUnit = pkgUnit;
  if (grossWeightKg != null) shipment.grossWeightKg = grossWeightKg;

  if (!shipment.countryOfOrigin && inv?.countryOfOrigin) shipment.countryOfOrigin = inv.countryOfOrigin;
  const originFallback = inv?.sellerCountry ?? shipment.consCountry;
  if (!shipment.countryOfOrigin && originFallback) {
    shipment.countryOfOrigin = originFallback;
    flags.push({
      severity: 'warning',
      path: 'shipment.countryOfOrigin',
      message: `Country of origin assumed from ${inv?.sellerCountry ? 'supplier country' : 'port of loading country'} (${originFallback}) — no COO/invoice declaration found, verify.`,
    });
  }
  if (!shipment.countryOfOrigin)
    flags.push({ severity: 'warning', path: 'shipment.countryOfOrigin', message: 'Country of origin not found on COO or invoice.' });

  // Marks & Nos conventions: air BEs print MAWB/HAWB; sea BEs print "AS PER BL".
  if (transportMode === 'Air') {
    shipment.marksAndNos = [shipment.mawbNo, shipment.hawbNo].filter(Boolean).join(' / ');
  } else if (bl) {
    if (shipment.marksAndNos && shipment.marksAndNos !== 'AS PER BL')
      flags.push({
        severity: 'info',
        path: 'shipment.marksAndNos',
        message: `Marks set to "AS PER BL" (BE convention); BL printed: ${shipment.marksAndNos.replace(/\s+/g, ' ').slice(0, 60)}`,
      });
    shipment.marksAndNos = 'AS PER BL';
  }

  if (bl?.isDraftDocument)
    flags.push({
      severity: 'warning',
      path: 'shipment.blNo',
      message: 'The bill of lading appears to be a DRAFT — confirm the final BL number and date before filing.',
    });

  // Consignment country: where goods were consigned from (port of loading country).
  flags.push({
    severity: 'info',
    path: 'shipment.eta',
    message: 'ETA not automated yet — key it from the shipping line website / arrival notice.',
  });

  // ---- Filing status suggestion ----
  const filingStatus: ChecklistDraft['filingStatus'] = transportMode === 'Air' ? 'Prior' : 'Normal';
  flags.push({
    severity: 'info',
    path: 'filingStatus',
    message: `Filing status suggested as ${filingStatus} (${transportMode} shipment) — adjust per IGM/inward timing.`,
  });

  // ---- Invoice & valuation ----
  const goodsItems = (inv?.items ?? []).filter((i) => !i.isCharge);
  const chargeItems = (inv?.items ?? []).filter((i) => i.isCharge);
  const goodsValue = goodsItems.reduce((a, i) => a + (i.amount ?? 0), 0);
  const toi = inv ? normalizeToi(inv.termsOfInvoice) : 'CIF';
  if (inv && inv.termsOfInvoice === 'UNKNOWN')
    flags.push({ severity: 'warning', path: 'invoice.termsOfInvoice', message: 'Terms of invoice unclear on documents — defaulted to C&F.' });

  // Freight/charge lines billed on the invoice ride as dutiable misc charges (per reference
  // job). The extractor may surface freight as charge line items OR as freightCharge — use
  // whichever is present (line items win to avoid double counting).
  const currency = inv?.currency ?? 'USD';
  let chargesTotal = chargeItems.reduce((a, i) => a + (i.amount ?? 0), 0);
  let chargesCurrency = currency;
  if (chargesTotal === 0 && inv?.freightCharge && inv.freightCharge.amount > 0) {
    chargesTotal = inv.freightCharge.amount;
    chargesCurrency = inv.freightCharge.currency;
  }

  // Ex-Works/FOB invoice that itself bills freight is effectively C&F on the BE
  // (reference job1: EXW invoice + freight line -> TOI C&F, freight as misc charges).
  let effectiveToi = toi;
  if ((toi === 'EXW' || toi === 'FOB') && chargesTotal > 0) {
    effectiveToi = 'C&F';
    flags.push({
      severity: 'info',
      path: 'invoice.termsOfInvoice',
      message: `Invoice is ${toi} but bills freight/charges (${chargesTotal} ${currency}) — TOI set to C&F with charges as misc.`,
    });
  }

  const rates = exchangeRatesOn(today);
  if (!rates[currency] && currency !== 'INR')
    flags.push({ severity: 'error', path: 'invoiceMeta.exchangeRate', message: `No customs exchange rate seeded for ${currency}.` });

  const invoice: ChecklistDraft['invoice'] = {
    invoiceNumber: inv?.invoiceNumber ?? '',
    invoiceDate: inv?.invoiceDate ?? '',
    termsOfInvoice: effectiveToi === 'EXW' ? 'FOB' : effectiveToi,
    currency,
    invoiceValue: goodsValue,
    ...(chargesTotal > 0 && { miscCharges: { amount: chargesTotal, currency: chargesCurrency } }),
  };
  if (effectiveToi === 'EXW')
    flags.push({
      severity: 'warning',
      path: 'invoice.termsOfInvoice',
      message: 'Invoice is Ex-Works — actual freight to port of loading must be added manually.',
    });
  if ((effectiveToi === 'FOB' || effectiveToi === 'C&F') && !invoice.insurance) {
    if (master?.marineOpenPolicyRatePercent) {
      invoice.insurance = { kind: 'percent', percent: master.marineOpenPolicyRatePercent };
      flags.push({
        severity: 'info',
        path: 'invoice.insurance',
        message: `Insurance applied at ${master.marineOpenPolicyRatePercent}% of C&F per the importer's marine open policy — replace with the actual premium when available.`,
      });
    } else {
      flags.push({
        severity: 'warning',
        path: 'invoice.insurance',
        message: `TOI is ${toi} — add actual insurance (or set the importer's marine open-policy rate in masters).`,
      });
    }
  }

  // ---- Items (description+HSN from invoice; rates from masters) ----
  const ftaScheme =
    coo?.schemeText && shipment.countryOfOrigin
      ? lookupFtaScheme(coo.schemeText, shipment.countryOfOrigin)
      : undefined;

  const items: DraftItem[] = goodsItems.map((gi, idx) => {
    // A valid HS/RITC candidate has at least 6 digits (part numbers and noise don't).
    const hsCandidates = [
      gi.hsCode,
      inv?.items.find((x) => x.hsCode)?.hsCode,
      coo?.hsCode,
      bl?.hsCode,
      awb?.hsCode,
    ]
      .map((c) => (c ?? '').replace(/\D/g, ''))
      .filter((c) => c.length >= 6);
    const hs = hsCandidates[0] ?? '';
    let tariff = hs.length >= 8 ? lookupTariff(hs.slice(0, 8)) : undefined;
    let ritc = hs.slice(0, 8);
    if (!tariff && hs.length >= 4 && hs.length < 8) {
      tariff = lookupTariffByPrefix(hs);
      if (tariff) {
        ritc = tariff.cth;
        flags.push({
          severity: 'warning',
          path: `items.${idx}.ritc`,
          message: `RITC ${tariff.cth} completed from ${hs.length}-digit HS ${hs} on the shipping docs — verify the full CTH.`,
        });
      }
    }
    // job memory: this importer has imported this product before
    if (!tariff && importer.name) {
      const memory = recallProductMemory(importer.name, gi.description);
      if (memory) {
        ritc = memory.ritc;
        tariff = lookupTariff(memory.ritc);
        flags.push({
          severity: 'info',
          path: `items.${idx}.ritc`,
          message: `RITC ${memory.ritc} recalled from job memory (learned from ${memory.learnedFrom}) for "${gi.description.slice(0, 40)}…" — verify.`,
        });
      }
    }
    if (!tariff)
      flags.push({
        severity: 'error',
        path: `items.${idx}.ritc`,
        message: `CTH ${hs || '(missing)'} not in tariff master for "${gi.description.slice(0, 60)}" — duty rates need manual entry.`,
      });
    const coaProduct = coa?.products.find(
      (p) =>
        (gi.batchNo && p.batchNo === gi.batchNo) ||
        gi.description.toUpperCase().includes((p.productCode ?? p.description).toUpperCase()) ||
        p.description.toUpperCase().includes(gi.description.slice(0, 25).toUpperCase()),
    );
    const batchNo = gi.batchNo ?? coaProduct?.batchNo ?? undefined;
    const mfg = gi.manufactureDate ?? coaProduct?.manufactureDate ?? undefined;
    const exp = gi.expiryDate ?? coaProduct?.expiryDate ?? undefined;

    return {
      slNo: idx + 1,
      description: gi.description,
      ritc,
      quantity: gi.quantity ?? 1,
      unit: normalizeUqc(gi.unit ?? 'NOS').uqc,
      unitPrice: gi.unitPrice ?? gi.amount,
      amount: gi.amount,
      bcdRate: tariff?.bcdRate ?? 0,
      swsRate: 10,
      igstRate: tariff?.igstRate ?? 0,
      ...(tariff && {
        igstNotification: tariff.igstNotification,
        aidcNotification: tariff.aidcNotification,
        compCessNotification: tariff.compCessNotification,
      }),
      aidcRate: tariff?.aidcRate ?? 0,
      compCessRate: tariff?.compCessRate ?? 0,
      ...(ftaScheme &&
        coo && {
          bcdExemption: {
            notification: ftaScheme.notification,
            serial: ftaScheme.serial,
            percent: ftaScheme.bcdExemptionPercent,
            scheme: ftaScheme.scheme,
          },
        }),
      ...(shipment.countryOfOrigin && { originCountry: shipment.countryOfOrigin }),
      ...(inv?.sellerName && {
        manufacturerName: inv.sellerName,
        manufacturerAddress: inv.sellerAddressLines.join(', '),
      }),
      endUseCode: master?.defaultEndUseCode ?? 'GNX100',
      ...((batchNo ?? mfg ?? exp) && {
        batch: {
          ...(batchNo && { batchNo }),
          ...(mfg && { manufactureDate: mfg }),
          ...(exp && { expiryDate: exp }),
          ...(gi.quantity != null && { quantity: gi.quantity }),
        },
      }),
    };
  });

  // Unit normalisation to ICES UQCs, with MT -> KGS quantity conversion
  for (const [idx, gi] of goodsItems.entries()) {
    const item = items[idx]!;
    const rawUnit = (gi.unit ?? 'NOS').toUpperCase();
    if (rawUnit.startsWith('MT')) {
      item.quantity = (gi.quantity ?? 0) * 1000;
      item.unitPrice = (gi.unitPrice ?? 0) / 1000;
      if (item.batch?.quantity != null) item.batch.quantity = item.quantity;
      flags.push({
        severity: 'info',
        path: `items.${idx}.quantity`,
        message: 'Quantity converted MT → KGS for the BE.',
      });
    } else if (normalizeUqc(rawUnit).changed) {
      flags.push({
        severity: 'info',
        path: `items.${idx}.unit`,
        message: `Unit "${rawUnit}" normalised to UQC ${item.unit} (ICES accepts standard unit codes only).`,
      });
    }
  }

  // Single Window: shelf life + additional-product-information rows for PGA chapters
  const singleWindowInfo: ChecklistDraft['singleWindowInfo'] = [];
  for (const item of items) {
    const chapter = Number(item.ritc.slice(0, 2));
    singleWindowInfo.push({
      itemSlNo: item.slNo,
      infoType: 'Item Characteristics',
      qualifier: 'Standard UQC',
      ...(item.unit === 'KGS' ? { measurement: item.quantity, unit: 'KGS' } : {}),
    });
    const swRule = chapter ? singleWindowRuleForChapter(chapter) : undefined;
    if (swRule) {
      for (const row of swRule.infoRows) {
        singleWindowInfo.push({
          itemSlNo: item.slNo,
          infoType: row.infoType,
          qualifier: row.qualifier,
          ...(row.code ? { code: row.code } : {}),
        });
      }
      if (item.batch?.manufactureDate && item.batch.expiryDate) {
        const mfg = Date.parse(item.batch.manufactureDate);
        const exp = Date.parse(item.batch.expiryDate);
        const now = Date.parse(today);
        if (exp > mfg && exp > now) {
          item.residualShelfLifePercent = Math.round(((exp - now) / (exp - mfg)) * 10000) / 100;
        }
      }
      const missing = swRule.expectedDocs.join(' + ');
      flags.push({
        severity: 'warning',
        message: `${swRule.pga} item (chapter ${chapter}): customs will expect ${missing} as supporting documents — ensure they are available for eSanchit.`,
      });
    }
  }
  if (!docs.some((d) => d.docType === 'packing_list'))
    flags.push({ severity: 'info', message: 'No packing list detected among the uploads — usually expected as a supporting document.' });

  // ---- Cross-checks ----
  if (inv && bl?.invoiceNumberRef && !bl.invoiceNumberRef.includes(inv.invoiceNumber) && !inv.invoiceNumber.includes(bl.invoiceNumberRef))
    flags.push({
      severity: 'warning',
      path: 'invoice.invoiceNumber',
      message: `Invoice number on BL ("${bl.invoiceNumberRef}") differs from invoice ("${inv.invoiceNumber}").`,
    });
  if (inv && coo?.invoiceNumberRef && !coo.invoiceNumberRef.replace(/\s/g, '').includes(inv.invoiceNumber.replace(/\s/g, '')))
    flags.push({
      severity: 'warning',
      path: 'invoice.invoiceNumber',
      message: `Invoice number on COO ("${coo.invoiceNumberRef}") differs from invoice ("${inv.invoiceNumber}").`,
    });
  const hsSources = [
    { source: 'invoice', value: inv?.items.find((i) => i.hsCode)?.hsCode },
    { source: 'transport doc', value: bl?.hsCode ?? awb?.hsCode },
    { source: 'COO', value: coo?.hsCode },
  ].filter((s): s is { source: string; value: string } => s.value != null);
  const hsAgree = new Set(hsSources.map((s) => s.value.replace(/\D/g, '').slice(0, 6)));
  if (hsAgree.size > 1)
    flags.push({
      severity: 'warning',
      path: 'items.0.ritc',
      message: `HS code differs across documents: ${hsSources.map((s) => `${s.value} (${s.source})`).join(', ')}.`,
    });
  if (coo && ftaScheme)
    flags.push({
      severity: 'info',
      path: 'ftaClaim',
      message: `FTA claim applied: ${ftaScheme.scheme} notification ${ftaScheme.notification} (${ftaScheme.bcdExemptionPercent}% BCD exemption) — verify origin criterion "${coo.originCriterion ?? '?'}".`,
    });
  if (coo && !ftaScheme)
    flags.push({
      severity: 'warning',
      path: 'ftaClaim',
      message: 'COO present but no FTA scheme matched in masters — preferential duty not applied.',
    });
  for (const doc of docs) {
    const uncertain = (doc.data as { uncertainFields?: string[] } | null)?.uncertainFields ?? [];
    if (uncertain.length)
      flags.push({
        severity: 'warning',
        message: `${doc.fileName}: model unsure about ${uncertain.join(', ')} — verify against the document.`,
      });
  }

  const isFood = items.some((i) => {
    const ch = Number(i.ritc.slice(0, 2));
    return ch >= 2 && ch <= 22;
  });

  const draft: ChecklistDraft = {
    tenantId: chaProfile().tenantId,
    transportMode,
    beType: 'Home Consumption',
    customStation,
    filingStatus,
    importer,
    supplier: {
      name: inv?.sellerName ?? '',
      addressLines: inv?.sellerAddressLines ?? [],
      ...((inv?.sellerCountry ?? shipment.consCountry) != null && {
        country: inv?.sellerCountry ?? shipment.consCountry,
      }),
    },
    shipment,
    invoiceMeta: {
      ...(inv?.paymentTerms != null && { termsOfPayment: inv.paymentTerms }),
      paymentMethod: 'Transaction',
      natureOfTransaction: 'Sale',
      relatedParty: false,
      exchangeRate: { currency, rate: rates[currency] ?? 1 },
    },
    invoice,
    items,
    ...(ftaScheme &&
      coo && {
        ftaClaim: {
          scheme: ftaScheme.scheme,
          cooNumber: coo.certificateNumber,
          ...(coo.issueDate != null && { cooDate: coo.issueDate }),
          ...(coo.issuingCountry != null && { countryOfIssue: coo.issuingCountry }),
          ...(coo.originCriterion != null && {
            // COO-form letter -> ICES criterion code (e.g. DFTP "A" -> COWO)
            originCriterion:
              ftaScheme.criterionMap?.[coo.originCriterion.replace(/[^A-Za-z0-9]/g, '').toUpperCase()] ??
              coo.originCriterion,
          }),
          directConsignment: true,
        },
      }),
    singleWindowInfo,
    supportingDocs: docs.map((d) => ({ fileName: d.fileName, docType: d.docType })),
    declarations: applicableDeclarations({
      ftaClaimed: Boolean(ftaScheme),
      isChemicalWithoutCas: items.some((i) => Number(i.ritc.slice(0, 2)) >= 28 && Number(i.ritc.slice(0, 2)) <= 38),
      isFood,
    }).map((d) => ({ code: d.code, text: d.text })),
    duty: null,
    fieldMeta,
    flags,
  };

  // ---- Duty computation (only when we have enough to compute) ----
  try {
    if (items.length && goodsValue > 0) draft.duty = computeJobDuty(toInvoiceInput(draft), rates);
  } catch (err) {
    flags.push({ severity: 'error', message: `Duty computation failed: ${(err as Error).message}` });
  }

  return draft;
}
