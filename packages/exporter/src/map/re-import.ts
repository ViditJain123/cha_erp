import {
  CUSTOM_HOUSES,
  logisysNotn,
  reImportEntry,
  reImportExclusion,
  reImportTimeLimit,
  type ReImportEntry,
} from '@checklist/core';
import type { DraftItem, ItemReImport } from '@checklist/extraction';
import { BLANK, code, int, isoDate, money } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * RE-IMPORT — the shipping bill goods went out under, and the notification
 * entry that says how much duty comes back with them.
 *
 * One row per line of goods that is a re-import, keyed `Inv_SrNo` /
 * `Item_SrNo`. `docs/boe-mapping/09-re-import.md` is the contract.
 *
 * ICES carries this as `<TABLE>REIMPORT` (`BE Message format 2.25`, CACHI01
 * Part 13/24). Of its nineteen fields Logi-Sys asks for thirteen and adds two
 * of its own: `File_No` and `IGSTPaid` are in no ICES message and in no printed
 * Bill of Entry, and Logi-Sys' own export leaves `File_No` empty on a live
 * re-import, so we write it blank.
 *
 * The table is mandatory when the item declares itself a re-import — ICES field
 * 75, "Whether Re-import (Y/N)". The Logi-Sys ITEMS sheet has no such column,
 * so Logi-Sys sets that flag from the presence of a row here against the line.
 * The `(Inv_SrNo, Item_SrNo)` pair is therefore load-bearing in both
 * directions, and errors 321, 322, 387 and 388 are the four ways to get it
 * wrong.
 *
 * The rejections this mapper exists to make impossible are real ones, from
 * `data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf`:
 * 352 invalid re-import notification or serial, 353/355 export freight and
 * insurance present when they must not be and absent when they must be,
 * 354/356/357 the same for the duty amounts, 371–379 each key field null, zero
 * or negative, 387 a row against an item that does not exist, 388 re-import
 * details on a line not declared as one.
 *
 * Nothing here chooses the notification entry. A shipping bill's scheme flags
 * usually fit several entries of 45/2017 and one row carries one entry; which
 * Kuberr claims is an open question, so the export refuses until a person has
 * said. An unconfirmed notification is a duty claim nobody made.
 */
export function reImportRows(ctx: MapContext): SheetRow[] {
  const lines = ctx.draft.items.filter((item) => item.reImport);
  // An ordinary import leaves the sheet exactly as the vendor shipped it.
  if (lines.length === 0) return [];

  const rows: SheetRow[] = [];
  for (const item of lines) {
    const row = reImportRow(ctx, item, item.reImport!);
    if (row) rows.push(row);
  }
  return rows;
}

function reImportRow(ctx: MapContext, item: DraftItem, re: ItemReImport): SheetRow | undefined {
  const path = `RE-IMPORT[${item.invoiceSrNo}/${item.slNo}]`;
  const label = `Item ${item.invoiceSrNo}/${item.slNo}`;

  // ---- the goods are outside the notifications altogether ----
  // Not a missing value: a fact about the export that no entry answers to.
  const exclusion =
    re.exclusion ?? reImportExclusion(re.purpose ? { purpose: re.purpose } : {});
  if (exclusion) {
    ctx.blocker(path, `${label}: ${exclusion}`);
    return undefined;
  }

  // ---- ICES 371/372 — the pair that ties this row to a line of goods ----
  // Derived from the draft, so a zero here is a broken draft rather than a
  // missing document, and it would make ICES reject the row (387/388).
  if (!(item.invoiceSrNo > 0) || !(item.slNo > 0)) {
    ctx.blocker(
      path,
      `${label}: a re-import row has to name the invoice and item it belongs to, and this one ` +
        'does not. ICES matches the row against the line and rejects it otherwise.',
    );
    return undefined;
  }

  // ---- ICES 388 — the exemption is claimed here, not on ITEMS ----
  // ex_job29's ITEMS row leaves Basic_Notn empty and ex_job3's checklist prints
  // the tariff rate of 30% with BCD Amt 0.00 and Cus. Notn blank: the re-import
  // notification carries the relief on its own. Filing it in both places claims
  // it twice.
  const basicClaim = item.fta?.notification ?? item.bcdExemption?.notification ?? item.bcdNotification;
  if (basicClaim) {
    ctx.blocker(
      `${path}.Notn_No`,
      `${label} is a re-import and also carries ${basicClaim} as its basic-duty notification. The ` +
        're-import exemption is claimed on this sheet alone — Logi-Sys leaves ITEMS.Basic_Notn ' +
        'empty on a re-import, and declaring the relief twice overstates it.',
    );
  }

  // ---- ICES 375/376 — the shipping bill ----
  const sbNo = re.sbNo?.value?.trim() ?? '';
  if (!sbNo || /^0+$/.test(sbNo)) {
    ctx.blocker(
      `${path}.SB_No`,
      `${label}: no shipping bill number. It is the record ICES matches the claim against — ` +
        'without it there is no evidence these goods ever left India.',
    );
  } else if (!/^\d{1,7}$/.test(sbNo)) {
    ctx.blocker(
      `${path}.SB_No`,
      `${label}: shipping bill number "${sbNo}" is not the seven digits ICES holds. A port code ` +
        'or a job reference has been read in place of the number.',
    );
  }

  const sbDate = re.sbDate?.value;
  if (!sbDate) {
    ctx.blocker(`${path}.SB_Date`, `${label}: no shipping bill date.`);
  } else {
    const beDate = ctx.draft.shipment.beFilingDate ?? new Date().toISOString().slice(0, 10);
    if (sbDate > beDate) {
      ctx.blocker(
        `${path}.SB_Date`,
        `${label}: the shipping bill is dated ${sbDate}, after this Bill of Entry. The goods ` +
          'cannot come back before they left.',
      );
    }
  }

  // ---- ICES 379 — the port they left from ----
  const port = re.portOfExport?.value?.trim().toUpperCase() ?? '';
  if (!port) {
    ctx.blocker(`${path}.Port_of_Export`, `${label}: no port of export on the shipping bill.`);
    // Matched strictly against the code, not through the fuzzy name resolver:
    // that one answers "Nhava Sheva Sea" with INNSA1, which is the helpful
    // thing to do everywhere except here, where writing the name instead of
    // the code is the mistake this check exists to catch.
  } else if (!CUSTOM_HOUSES.some((h) => h.code === port || h.ediCode === port)) {
    ctx.blocker(
      `${path}.Port_of_Export`,
      `${label}: "${port}" is not a customs station ICES holds. This column takes the six-character ` +
        'code from the shipping bill\'s header, not the port\'s name — the checklist prints ' +
        '"Nhava Sheva Sea" where the workbook wants INNSA1.',
    );
  }

  // ---- ICES 377/378 — the shipping bill's own serials ----
  // The message spec marks both optional. The error list rejects them anyway,
  // so they are mandatory here.
  const sbInvSrNo = re.sbInvSrNo?.value;
  const sbItemSrNo = re.sbItemSrNo?.value;
  if (!Number.isFinite(sbInvSrNo) || (sbInvSrNo ?? 0) <= 0) {
    ctx.blocker(
      `${path}.SB_Inv_SrNo`,
      `${label}: no invoice serial within shipping bill ${sbNo || '(unknown)'}. It is the export ` +
        'side\'s own numbering, not this Bill of Entry\'s, and ICES uses it to find the line ' +
        'that went out.',
    );
  }
  if (!Number.isFinite(sbItemSrNo) || (sbItemSrNo ?? 0) <= 0) {
    ctx.blocker(
      `${path}.SB_Item_SrNo`,
      `${label}: no item serial within shipping bill ${sbNo || '(unknown)'}. A bill may carry ` +
        'several lines and only one of them came back.',
    );
  }

  // ---- ICES 352/373/374 — the entry claimed ----
  const entry = resolveEntry(ctx, path, label, re);

  // ---- ICES 353/355 and 354/356/357 — the money, against the entry ----
  const amounts = checkAmounts(ctx, path, label, re, entry);

  if (entry) {
    warnAboutEntry(ctx, path, label, re, entry);
  }

  return {
    Inv_SrNo: int(item.invoiceSrNo),
    Item_SrNo: int(item.slNo),
    SB_No: code(sbNo),
    SB_Date: isoDate(sbDate),
    Port_of_Export: code(port),
    SB_Inv_SrNo: int(sbInvSrNo),
    SB_Item_SrNo: int(sbItemSrNo),
    Notn_No: code(entry ? entry.notification : logisysNotn(re.notification?.value.notification)),
    Notn_SrNo: code(entry ? entry.serial : re.notification?.value.serial),
    // Logi-Sys writes 0.00 rather than blank in all six money columns, on the
    // one populated example the vendor has ever given us. An unknown amount
    // cannot reach here: the entry either requires it, and its absence is a
    // blocker above, or forbids it, and zero is the right claim.
    'Exp._Freight': money(amounts.exportFreight),
    'Exp.Insurance': money(amounts.exportInsurance),
    'Cus.Duty': money(amounts.customsDuty),
    Excise_Duty: money(amounts.exciseDuty),
    // Not an ICES field, and empty in Logi-Sys' own export of a live re-import.
    // docs/boe-mapping/open-questions.md#reimport-file-no.
    File_No: BLANK,
    IGSTPaid: money(amounts.igstPaid),
  };
}

/** The entry claimed, once someone has confirmed one that exists. */
function resolveEntry(
  ctx: MapContext,
  path: string,
  label: string,
  re: ItemReImport,
): ReImportEntry | undefined {
  const chosen = re.notification?.value;
  if (!chosen?.notification || !chosen.serial) {
    const offered = (re.candidates ?? [])
      .map((c) => `${c.notification} ${c.serial} (${c.description})`)
      .join('; ');
    ctx.blocker(
      `${path}.Notn_SrNo`,
      `${label}: no re-import notification has been confirmed. ` +
        (offered
          ? `The shipping bill fits ${offered}. One row carries one entry, and the entry decides ` +
            'which amounts ICES demands — confirm which is being claimed on the job screen.'
          : 'Nothing on the shipping bill shows what was claimed at export, so the entry has to ' +
            'be chosen on the job screen.'),
    );
    return undefined;
  }

  const entry = reImportEntry(chosen.notification, chosen.serial);
  if (!entry) {
    ctx.blocker(
      `${path}.Notn_SrNo`,
      `${label}: ${chosen.notification} serial ${chosen.serial} is not an entry of any re-import ` +
        'notification we hold. ICES validates the pair and rejects the filing (error 352).',
    );
    return undefined;
  }

  if (re.notification?.source === 'default') {
    ctx.blocker(
      `${path}.Notn_SrNo`,
      `${label}: ${entry.notification} ${entry.serial} is a proposal nobody has confirmed. The ` +
        'entry decides how much duty is paid on goods coming home — it is not a default.',
    );
  }
  return entry;
}

interface ReImportAmounts {
  exportFreight: number;
  exportInsurance: number;
  customsDuty: number;
  exciseDuty: number;
  igstPaid: number;
}

/**
 * The six money columns, checked against the entry that governs them.
 *
 * ICES validates them in both directions and rejects either way, so "we do not
 * know" and "not applicable" cannot both be written as blank. Each pair is
 * required by some entries and forbidden by the rest.
 */
function checkAmounts(
  ctx: MapContext,
  path: string,
  label: string,
  re: ItemReImport,
  entry: ReImportEntry | undefined,
): ReImportAmounts {
  const freight = re.exportFreightInr?.value;
  const insurance = re.exportInsuranceInr?.value;
  const customs = re.customsDuty?.value;
  const excise = re.exciseDuty?.value;
  const igst = re.igstPaid?.value;

  const stated = (v: number | undefined) => Number.isFinite(v) && (v as number) !== 0;

  if (entry?.exportFreightInsurance === 'required') {
    if (!stated(freight) && !stated(insurance)) {
      ctx.blocker(
        `${path}.Exp._Freight`,
        `${label}: ${entry.notification} ${entry.serial} charges duty on the cost of the work done ` +
          'abroad plus insurance and freight **both ways**, so the export leg\'s freight and ' +
          'insurance are part of the value. Neither is stated. Ask the shipper for the freight ' +
          'and insurance certificates, or take the figures off the shipping bill — in rupees, ' +
          'apportioned to this line.',
      );
    }
  } else if (entry && (stated(freight) || stated(insurance))) {
    ctx.blocker(
      `${path}.Exp._Freight`,
      `${label}: ${entry.notification} ${entry.serial} does not value the goods on the cost of ` +
        'repairs, so ICES requires the export freight and insurance to be nil (error 353). These ' +
        'look like the inbound leg\'s figures, which belong to INVOICES.',
    );
  }

  if (entry?.incentiveRepayment === 'required') {
    if (!stated(customs) && !stated(excise) && !stated(igst)) {
      ctx.blocker(
        `${path}.Cus.Duty`,
        `${label}: ${entry.notification} ${entry.serial} is for goods exported with an incentive, ` +
          `and the duty on re-import is ${entry.amountPayable.split(',')[0]}. Nothing is stated. ` +
          'The amount is on the export invoice or in the importer\'s instruction — it is a ' +
          'payment, not something to compute from a drawback rate.',
      );
    }
  } else if (entry && (stated(customs) || stated(excise) || stated(igst))) {
    ctx.blocker(
      `${path}.Cus.Duty`,
      `${label}: ${entry.notification} ${entry.serial} repays no export incentive, so ICES requires ` +
        'these amounts to be zero (errors 356 and 357).',
    );
  }

  return {
    exportFreight: freight ?? 0,
    exportInsurance: insurance ?? 0,
    customsDuty: customs ?? 0,
    exciseDuty: excise ?? 0,
    igstPaid: igst ?? 0,
  };
}

/** Everything about the entry that is worth saying but does not stop the filing. */
function warnAboutEntry(
  ctx: MapContext,
  path: string,
  label: string,
  re: ItemReImport,
  entry: ReImportEntry,
): void {
  const limit = reImportTimeLimit(entry, {
    ...(re.sbDate?.value ? { sbDate: re.sbDate.value } : {}),
    ...(ctx.draft.shipment.beFilingDate ? { beDate: ctx.draft.shipment.beFilingDate } : {}),
    ...(re.purpose ? { purpose: re.purpose } : {}),
  });
  if (Number.isFinite(limit.elapsedMonths) && !limit.withinLimit) {
    ctx.warn(
      `${path}.SB_Date`,
      `${label}: the goods come back ${limit.elapsedMonths} months after export, past the ` +
        `${limit.limitMonths} months ${entry.notification} ${entry.serial} allows. ` +
        (limit.withinExtension
          ? 'A Principal Commissioner or Commissioner may extend that on sufficient cause — the ' +
            'extension letter has to be on the job and uploaded to eSanchit.'
          : `Even the ${limit.extensionMonths}-month extension does not reach, so the exemption is ` +
            'out of time and the claim needs a different basis.'),
    );
  }

  if (entry.notification === '158/1995') {
    // The sheet is mapped now (17-bonds-certificates.md); what is missing is the
    // bond itself, which only the operator can supply — its number and the
    // station it is registered at are on a document Customs issued, not on
    // anything the job carries.
    const hasReExportBond = (ctx.draft.bonds ?? []).some(
      (b) => b.kind === 'bond' && b.type?.toUpperCase() === 'RE',
    );
    if (!hasReExportBond) {
      ctx.warn(
        `${path}.Notn_No`,
        `${label}: ${entry.notification} runs against a bond undertaking to re-export within six ` +
          'months, and no re-export bond (code RE) is recorded on this job. Add it on the bond ' +
          'panel so it reaches the BONDS_CERTIFICATES sheet.',
      );
    }
  }

  // 45/2017's own paragraph 2. The entry's window is the check; this explains it.
  const sbDate = re.sbDate?.value;
  if (sbDate && entry.leoFrom && sbDate < entry.leoFrom) {
    ctx.blocker(
      `${path}.Notn_No`,
      `${label}: shipping bill ${re.sbNo?.value ?? ''} is dated ${sbDate}, before ` +
        `${entry.leoFrom}. ${entry.notification} applies only where the order permitting clearance ` +
        'under section 51 was given on or after that date — an older export claims under 94/96.',
    );
  }
  if (sbDate && entry.leoUntil && sbDate > entry.leoUntil) {
    ctx.blocker(
      `${path}.Notn_No`,
      `${label}: shipping bill ${re.sbNo?.value ?? ''} is dated ${sbDate}, after ` +
        `${entry.notification} was superseded on ${entry.leoUntil}. This export claims under ` +
        '45/2017 or 46/2017.',
    );
  }

  // The two pre-2000 notifications are the only ones no golden shows us
  // Logi-Sys' spelling for. docs/boe-mapping/open-questions.md#reimport-old-notn.
  if (entry.notification === '094/1996' || entry.notification === '158/1995') {
    ctx.warn(
      `${path}.Notn_No`,
      `${label}: written as ${entry.notification}, the four-digit-year spelling every other ` +
        'notification column uses. No Logi-Sys export we hold claims a pre-2000 notification, so ' +
        `if the upload is rejected try ${entry.notification.replace(/\/\d{2}(\d{2})$/, '/$1')}.`,
    );
  }
}
