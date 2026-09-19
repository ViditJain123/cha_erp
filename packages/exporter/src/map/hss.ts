import { BLANK, code, int, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * The IE Codes DGFT issues to importers who are exempt from holding one of
 * their own (BE Message format 2.25, p.14, the list under `<TABLE>BE`).
 *
 * They matter here and nowhere else on this sheet: ICES fills a regular
 * importer's name and address from its own IEC directory, but for one of these
 * it cannot, so the spec makes the particulars mandatory and ICES rejects a row
 * without them (error 164).
 */
const EXEMPTED_CATEGORY_IECS = new Set([
  '0100000011', // Central Govt. Min/Depts
  '0100000029', // State Govt. Min/Depts
  '0100000037', // UNO / diplomatic officers
  '0100000045', // Indians claiming baggage rules
  '0100000053', // Importing goods for personal use
  '0100000061', // Importing goods from Nepal
  '0100000070', // Importing goods from Myanmar, CIF <= Rs. 25000
  '0100000088', // Ford Foundation
  '0100000096', // Display / fairs under ATA carnet
  '0100000100', // Blood group ref. lab, Mumbai
  '0100000126', // Individual / charitable institutions, NGOs
  '0100000001', // Others, with permission
]);

/**
 * HSS — who owned the goods before the importer did, while they were at sea.
 *
 * ICES `<TABLE>HSS` (BE Message format 2.25, CACHI01 Part 12/24). **One row per
 * party in the chain of sales**, ordered by the spec's *preceding level*: `0`
 * is the party who sold to the filing importer, `1` that party's seller. The
 * filing importer is declared on GENERAL and never appears here — emitting them
 * as level 0 shifts every real party down one and misstates the whole chain.
 * Contract: docs/boe-mapping/16-hss.md.
 *
 * The sheet has no invoice or item key: a high-seas sale is a fact about the
 * consignment. The money it moves is declared on INVOICES as the HSS loading.
 *
 * Three things move together and ICES rejects any two of the three on their own
 * (error 116): `GENERAL.IsHSS`, rows here, and the loading on INVOICES.
 */
export function hssRows(ctx: MapContext): SheetRow[] {
  const flagged = ctx.draft.boe?.flags?.hss === true;
  const chain = [...(ctx.draft.hssChain ?? [])].sort((a, b) => a.level - b.level);

  // An ex-bond BE may not carry this segment at all — ICES 664. The high-seas
  // sale, if there was one, was declared on the into-bond filing.
  if (ctx.draft.beType === 'Ex-Bond') {
    if (chain.length) {
      ctx.warn(
        'HSS',
        'This is an ex-bond Bill of Entry, which ICES does not accept high-seas-sale details on ' +
          '(error 664). The chain was declared on the into-bond filing; the sheet is left empty.',
      );
    }
    return [];
  }

  if (!flagged) {
    if (chain.length) {
      ctx.warn(
        'HSS',
        `${chain.length} high-seas seller${chain.length === 1 ? ' is' : 's are'} recorded on the job ` +
          'but it is not flagged as a high seas sale, so nothing is declared. Tick the high-seas-sale ' +
          'box on the job if that is what this is.',
      );
    }
    return [];
  }

  if (!chain.length) {
    ctx.blocker(
      'HSS',
      'The job is flagged as a high seas sale but names no seller. ICES requires the particulars of ' +
        'the party who sold the goods afloat (error 116), so the Bill of Entry cannot be filed until ' +
        'the chain is recorded — start with the high-seas-sale agreement.',
    );
    return [];
  }

  if (chain[0]!.level !== 0) {
    ctx.blocker(
      'HSS',
      `The high-seas chain starts at level ${chain[0]!.level}, not 0. Level 0 is the party who sold ` +
        'to the importer filing this Bill of Entry, and it is the price Customs assesses against — ' +
        'the immediate seller is missing.',
    );
    return [];
  }

  const rows: SheetRow[] = [];
  for (const party of chain) {
    if (!party.iec) {
      ctx.blocker(
        'HSS',
        `The high-seas seller at level ${party.level}${party.name ? ` (${party.name})` : ''} has no ` +
          'IE Code. ICES looks the party up by it (error 161) and the row cannot be filed without one.',
      );
      return [];
    }

    const exempted = EXEMPTED_CATEGORY_IECS.has(party.iec.trim());
    if (exempted && !(party.name && party.address && party.city && party.postalCode)) {
      ctx.blocker(
        'HSS',
        `IE Code ${party.iec} at level ${party.level} is an exempted-category code, so ICES cannot ` +
          'fill the party from its own directory and requires the name, address, city and pin on the ' +
          'declaration (error 164). Key the missing particulars from the high-seas-sale agreement.',
      );
      return [];
    }

    if (party.branchSrNo == null) {
      ctx.warn(
        'HSS',
        `No branch serial for the high-seas seller at level ${party.level}` +
          `${party.name ? ` (${party.name})` : ''}. ICES rejects an unregistered branch (error 163) ` +
          'and there is no safe default — set it in Logi-Sys from the seller’s DGFT registration.',
      );
    }

    rows.push({
      // C(1) in the spec, so a character rather than a number.
      Level: code(String(party.level)),
      HSS_Name: text(party.name),
      HSS_BranchName: text(party.branchName),
      HSS_BranchSr: party.branchSrNo == null ? BLANK : int(party.branchSrNo),
      HSS_IECode: code(party.iec),
      // The seller's own bank AD code. It reaches no ICES field, so it is filled
      // where the organization repository knows the party and left blank
      // otherwise rather than proposed.
      HSS_ADCode: code(party.adCode),
      HSS_Address: text(party.address),
      HSS_City: text(party.city),
      HSS_Country: text(party.country),
      HSS_PostalCode: code(party.postalCode),
    });
  }

  return rows;
}
