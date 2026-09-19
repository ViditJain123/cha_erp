import {
  CHEMICAL_CATEGORIES,
  isChemicalDeclarationCth,
  isHazardousCth,
  singleWindowRuleForChapter,
  standardQuantity,
  weightToKg,
} from '@checklist/core';
import type { DraftFlag, DraftItem, SingleWindowInfoRow } from './draft.js';

/**
 * The Single Window declarations a line of goods carries.
 *
 * SW_ADDL_INFO is ICES `<TABLE>BE_ITEM_SW_INFO_TYPE` (CACHI01 Part 19/24), and
 * every family in it is triggered by the line's own tariff code — nothing on
 * the sheet is per-job. Contract and evidence: docs/boe-mapping/11-sw-addl-info.md.
 *
 * Lives in its own module, and not inline in `buildDraft`, because the version
 * that was inline was wrong for three years in a way no test could see: it
 * wrote the standard quantity only `if (item.unit === 'KGS')`, so every line
 * invoiced in `SET`, `UNT` or `MTS` filed a Single Window quantity of zero with
 * no unit — ICES 488/493, a hard reject. The fix is only half the work if the
 * seam stays untestable.
 */
export function singleWindowRowsForItem(
  item: DraftItem,
  today: string,
): { rows: SingleWindowInfoRow[]; flags: DraftFlag[] } {
  const rows: SingleWindowInfoRow[] = [];
  const flags: DraftFlag[] = [];
  const at = { invoiceSrNo: item.invoiceSrNo, itemSlNo: item.slNo };
  const where = `Invoice ${item.invoiceSrNo} item ${item.slNo} (${item.ritc})`;
  const path = `items.${item.slNo - 1}`;

  /*
   * SQC — the standard quantity. On every line of every Bill of Entry: 22 of
   * 22 lines in the corpus carry it, across eight chapters and all three BE
   * types. The unit is the CTH's ITCHS standard unit and never the invoice
   * unit — I-60133 is invoiced as 1 SET and filed as 1.000000 NOS.
   */
  const suqc = standardQuantity(item.ritc, item.quantity, item.unit, weightToKg);
  rows.push({
    ...at,
    infoType: 'Item Characteristics',
    qualifier: 'Standard UQC',
    ...(suqc.ok ? { measurement: suqc.quantity, unit: suqc.uqc } : {}),
  });
  if (!suqc.ok) {
    flags.push({
      severity: 'error',
      path: `${path}.quantity`,
      message:
        `${where}: cannot state the Single Window standard quantity — ${suqc.reason}. ` +
        'ICES requires it on every line (error 493/494), so the Bill of Entry cannot be ' +
        'filed until the tariff unit is known.',
    });
  } else if (suqc.uqc !== item.unit) {
    flags.push({
      severity: 'info',
      path: `${path}.unit`,
      message:
        `${where}: Single Window standard quantity stated as ${suqc.quantity} ${suqc.uqc} ` +
        `(the tariff unit for this CTH), against an invoice unit of ${item.unit}.`,
    });
  }

  /*
   * The chemical declaration — Circular 15/2023 as amended by 23/2023,
   * mandatory for every BE filed on or after 15.10.2023. Chapters 28, 29, 32
   * and 39, and heading 3808 alone out of chapter 38.
   */
  if (isChemicalDeclarationCth(item.ritc)) {
    const chem = item.chemical;
    const category = CHEMICAL_CATEGORIES.find((c) => c.code === chem?.category);
    if (category) {
      rows.push({
        ...at,
        infoType: 'Item Category',
        qualifier: 'Chemical Category (CPC)',
        code: category.code,
      });
    } else {
      // Warns rather than blocks only because there is no screen to set it on
      // yet; see the contract. It is a rejection at filing either way.
      flags.push({
        severity: 'warning',
        path: `${path}.chemical.category`,
        message:
          `${where}: chapters 28/29/32/39 and heading 3808 must declare a chemical category ` +
          '(CPCBB bulk and basic, CPCFM formulations and mixtures, CPCPR proprietary/R&D/other) ' +
          'in the Single Window table. Set it in Logi-Sys before filing — ICES rejects the ' +
          'Bill of Entry without it.',
      });
    }
    if (chem?.casNumber) {
      rows.push({
        ...at,
        infoType: 'Item Identification',
        qualifier: 'Chemical Abstract Service registration number.',
        information: chem.casNumber,
      });
    }
    if (chem?.iupacName) {
      rows.push({
        ...at,
        infoType: 'Product Name',
        qualifier: 'Name as per the IUPAC Nomenclature',
        information: chem.iupacName,
      });
    }
    // What declaring a category then obliges, per Circular 23/2023 para 4.1(b).
    // PC002 on STATEMENT is the way out when a supplier withholds it, and is
    // filed on this same scope.
    const have = [chem?.casNumber, chem?.iupacName].filter(Boolean).length;
    if (category && (category.requires === 'both' ? have < 2 : have < 1)) {
      flags.push({
        severity: 'warning',
        path: `${path}.chemical`,
        message:
          `${where}: ${category.label} requires ` +
          (category.requires === 'both'
            ? 'both the CAS number and the IUPAC name'
            : 'the CAS number or the IUPAC name') +
          (category.perIngredient ? ' of the main/active ingredient' : '') +
          '. Not on the job — supply them, or file PC002 to certify the supplier withheld ' +
          'them (ICES 876).',
      });
    }
  } else if (item.chemical?.category || item.chemical?.casNumber || item.chemical?.iupacName) {
    // Out of scope and carrying chemical particulars: filing them is ICES
    // 877/931, so they are held back rather than passed through.
    flags.push({
      severity: 'warning',
      path: `${path}.chemical`,
      message:
        `${where}: chemical particulars are recorded but this CTH is outside chapters ` +
        '28/29/32/39 and heading 3808, so they are left out of the Single Window table.',
    });
  }

  /*
   * Hazardous cargo — Circular 24/2026, live across all formations since
   * 01.07.2026. Per CTH and not per chapter: of the three chapter-29 Bills of
   * Entry in the corpus filed after the mandate, only the one whose heading is
   * on Annexure-A carries the row.
   */
  if (isHazardousCth(item.ritc)) {
    if (item.hazardous === undefined) {
      flags.push({
        severity: 'warning',
        path: `${path}.hazardous`,
        message:
          `${where}: this tariff item is on Annexure-A of Circular 24/2026, so the Bill of ` +
          'Entry must answer whether the goods are hazardous cargo. Nobody has answered, so ' +
          'no declaration is made.',
      });
    } else {
      rows.push({
        ...at,
        infoType: 'Item Characteristics',
        qualifier: 'Hazardous',
        code: item.hazardous ? 'Y' : 'N',
      });
    }
  }

  /*
   * The PGA chapter rules — today only FSSAI's. The rule names the questions a
   * food or plant line has to answer; the answers are per line, and `ex_job24`
   * files STCNR/MSC/FC0102 on its lactose and STCCT18/AYU/FC0101 on its whey
   * protein, one Bill of Entry apart. So a code carried on the rule would
   * declare one line's facts about another line's goods, and the rule carries
   * none. See docs/boe-mapping/open-questions.md#sw-fssai-codes.
   */
  const chapter = Number(item.ritc.slice(0, 2));
  const rule = chapter ? singleWindowRuleForChapter(chapter) : undefined;
  if (rule) {
    const unanswered = rule.infoRows.filter((row) => !row.code);
    for (const row of rule.infoRows) {
      if (!row.code) continue;
      rows.push({ ...at, infoType: row.infoType, qualifier: row.qualifier, code: row.code });
    }
    if (unanswered.length) {
      flags.push({
        severity: 'warning',
        path,
        message:
          `${where}: a ${rule.pga} line must answer ` +
          `${unanswered.map((r) => `"${r.qualifier}"`).join(', ')} in the Single Window table. ` +
          'The answers are per line and none is recorded, so no declaration is made — set ' +
          'them in Logi-Sys before filing.',
      });
    }
    // The shortest-dated lot on the line decides its residual shelf life: FSSAI
    // clears the consignment, and the weakest batch is what it clears against.
    const dated = (item.batches ?? []).filter((b) => b.manufactureDate && b.expiryDate);
    const shortest = dated.sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))[0];
    if (shortest) {
      const mfg = Date.parse(shortest.manufactureDate!);
      const exp = Date.parse(shortest.expiryDate!);
      const now = Date.parse(today);
      if (exp > mfg && exp > now) {
        item.residualShelfLifePercent = Math.round(((exp - now) / (exp - mfg)) * 10000) / 100;
      }
    }
    flags.push({
      severity: 'warning',
      message:
        `${rule.pga} item (chapter ${chapter}): customs will expect ` +
        `${rule.expectedDocs.join(' + ')} as supporting documents — ensure they are ` +
        'available for eSanchit.',
    });
  }

  return { rows, flags };
}
