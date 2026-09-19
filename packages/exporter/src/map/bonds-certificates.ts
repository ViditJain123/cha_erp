import { BOND_CODES, CERTIFICATE_TYPES, isBondCode, isCertificateType } from '@checklist/core';
import type { BondOrCertificate } from '@checklist/extraction';
import { BLANK, code, isoDate, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * BONDS_CERTIFICATES — the security already lodged with Customs.
 *
 * The sheet is **two ICES tables merged**: `<TABLE>BOND` (BE Message format
 * 2.25, CACHI01 Part 10/24) and `<TABLE>CERT` (Part 11/24), discriminated by
 * column A. A bond carries a registration port and no date; a certificate a
 * date and no port — that is the two field lists, not a convention, and all
 * three populated vendor exports follow it:
 *
 *   ex_job25  B | DE | 2002542921 | – | – | – | – | INHZA1   (Advance Authorisation)
 *   ex_job26  B | EZ | 2002611612 | – | – | – | – | INHZA1   (EPCG — see below)
 *   ex_job31  C | MS | NOC/2026/000004873..6 | 03-Aug-2026    (DGCA import NOCs)
 *
 * All three are `H` type, so a bond is not a warehousing-only fact, and all
 * three set `GENERAL.IsBondsCertificates = Y`.
 * Contract: docs/boe-mapping/17-bonds-certificates.md.
 *
 * **Bond state is invisible to us.** ICES rejects a bond that is expired,
 * closed, uncredited or simply not there (505, 506, 504, 507) and nothing in
 * this system can see any of that. So a bond number is never carried over from
 * a previous job unconfirmed: a bond that was good last month is one of those
 * rejections this month, and the workbook cannot tell.
 */
export function bondsCertificatesRows(ctx: MapContext): SheetRow[] {
  const rows: SheetRow[] = [];

  for (const entry of ctx.draft.bonds ?? []) {
    const type = entry.type?.trim().toUpperCase();

    if (!entry.number?.trim()) {
      ctx.blocker(
        'BONDS_CERTIFICATES',
        `A ${entry.kind} of type ${type || '(untyped)'} is declared on this Bill of Entry with no ` +
          `number. ICES cannot look it up without one (error ${entry.kind === 'bond' ? 502 : 552}).`,
      );
      continue;
    }

    if (entry.kind === 'bond') {
      if (!isBondCode(type)) {
        ctx.blocker(
          'BONDS_CERTIFICATES',
          `"${type}" is not an ICES bond code (error 501). ${
            type === 'EB'
              ? 'An eBond declares its purpose code here instead of EB — ICES 553 says so outright.'
              : `The codes are ${Object.keys(BOND_CODES).join(', ')}, or an eBond purpose code.`
          }`,
        );
        continue;
      }
      if (!entry.registrationPortCode) {
        ctx.warn(
          'BONDS_CERTIFICATES',
          `Bond ${entry.number} (${BOND_CODES[type] ?? type}) has no registration port. ICES needs ` +
            'the station the bond is registered at, which is not always where this BE is filed — ' +
            'key it in Logi-Sys.',
        );
      }
      if (entry.proposed) {
        ctx.warn(
          'BONDS_CERTIFICATES',
          `Bond code ${type} (${BOND_CODES[type] ?? type}) for bond ${entry.number} was proposed ` +
            'from the licence on this filing, not stated. Confirm it before upload — ex_job26 is an ' +
            'EPCG job whose bond is registered as EZ, the EPZ code, so the mapping from scheme to ' +
            'bond code is not one we can assert.',
        );
      }
    } else {
      if (!isCertificateType(type)) {
        ctx.warn(
          'BONDS_CERTIFICATES',
          `"${type}" is not a certificate type we hold (error 551). The published list has only ` +
            `${Object.keys(CERTIFICATE_TYPES).join(' and ')}; the row is filed as given, because ` +
            'the directory is incomplete rather than the value wrong.',
        );
      }
      if (!entry.date && type !== 'EI') {
        ctx.warn(
          'BONDS_CERTIFICATES',
          `Certificate ${entry.number} has no date. ICES makes the number and date mandatory ` +
            'together (error 552), except on an IGCR IIN where the date is optional.',
        );
      }
    }

    rows.push(row(entry, type));
  }

  checkIgcrPair(ctx, ctx.draft.bonds ?? []);
  return rows;
}

function row(entry: BondOrCertificate, type: string): SheetRow {
  const isBond = entry.kind === 'bond';
  return {
    Bond_or_Certificate: code(isBond ? 'B' : 'C'),
    Bond_Cert_Type: code(type),
    // A bond number is N(10) and a certificate number C(30); both are strings
    // here, because a bond number's leading zeros are part of it.
    Bond_Cert_No: code(entry.number.trim()),
    // `<TABLE>BOND` has no date field at all, so a bond row leaves this blank
    // even when we know when it was executed. Both vendor bond rows do.
    Bond_Cert_Date: isBond ? BLANK : isoDate(entry.date),
    // The Central Excise jurisdiction, for a certificate produced in lieu of a
    // bond on an EOU or job-work filing. Blank everywhere else, as ex_job31 is.
    Commissionerate: isBond ? BLANK : text(entry.commissionerate),
    Division: isBond ? BLANK : text(entry.division),
    Range: isBond ? BLANK : text(entry.range),
    Registration_Port_Code: isBond ? code(entry.registrationPortCode) : BLANK,
  };
}

/**
 * IGCR needs both halves, and ICES has seven error codes about it.
 *
 * The bond is `B`/`EI` with the continuity bond number and port; the IIN goes
 * in the *certificate* number column against certificate type `EI`. Claiming
 * the concession without them is error 511 and filing them without the claim is
 * 512 — so this checks the pair is whole, and `items.ts` owns the claim itself.
 */
function checkIgcrPair(ctx: MapContext, bonds: BondOrCertificate[]): void {
  const bond = bonds.find((b) => b.kind === 'bond' && b.type?.toUpperCase() === 'EI');
  const iins = bonds.filter((b) => b.kind === 'certificate' && b.type?.toUpperCase() === 'EI');

  if (iins.length > 1) {
    ctx.blocker(
      'BONDS_CERTIFICATES',
      `${iins.length} IGCR Identification Numbers are declared. ICES accepts exactly one per Bill ` +
        'of Entry (error 517).',
    );
  }

  if (bond && !iins.length) {
    ctx.blocker(
      'BONDS_CERTIFICATES',
      `An IGCR bond (${bond.number}) is declared with no IIN. ICES requires the IIN from Form ` +
        'IGCR-1 as a certificate of type EI alongside it (errors 513, 514).',
    );
  }

  if (!bond && iins.length) {
    ctx.blocker(
      'BONDS_CERTIFICATES',
      `IIN ${iins[0]!.number} is declared with no IGCR bond. ICES requires the continuity bond as ` +
        'bond code EI alongside it (error 516).',
    );
  }
}
