import { describeWarehouseCodeError, parseWarehouseCodeResult } from '@checklist/core';
import { BLANK, code, isoDate, text, ynBlank } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * INBOND_EXBOND — the warehouse a bonded Bill of Entry concerns.
 *
 * Empty for a home-consumption BE, which is the common case and which is why
 * this sheet sat unmapped: returning no rows leaves it header-only, byte for
 * byte, exactly as before.
 *
 * For a `W` (into-bond) or `EX` (ex-bond) BE it is the sheet the filing cannot
 * happen without. Two facts drive how strict this mapper is:
 *
 *   - Since 1 September 2025 (`data/customs-corpus/icegate-specs/advisory -
 *     changes in ex-bonding_0.pdf`) ex-bonding is allowed only against ICES's
 *     own ledger, mapped to both the ex-bonder's IEC and the declared
 *     warehouse. A wrong warehouse code is not a cosmetic error — the release
 *     is refused.
 *   - `BE Message format 2.25` makes Warehouse Code, Ware house BE No and Ware
 *     house BE Date all mandatory on an ex-bond BE.
 *
 * So a missing or malformed warehouse code blocks, and so does an ex-bond BE
 * with no into-bond BE behind it. The alternative is a workbook that claims to
 * release goods from a warehouse nobody named.
 *
 * The per-column contract is `docs/boe-mapping/02-inbond-exbond.md`.
 */
export function inbondExbondRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;
  const beType = draft.boe?.beType.value ?? draft.beType;

  // A home-consumption BE has no warehouse. No row, and the sheet stays exactly
  // as the vendor shipped it.
  if (beType === 'Home Consumption') return [];

  const block = draft.inbondExbond;
  const isExBond = beType === 'Ex-Bond';
  const label = isExBond ? 'ex-bond' : 'into-bond';

  if (!block) {
    ctx.blocker(
      'INBOND_EXBOND',
      `This is a ${label} Bill of Entry and its warehouse details have not been resolved. ` +
        'Re-read the documents from the job screen, then complete the bond panel.',
    );
    return [];
  }

  // ---------------------------------------------------- warehouse code ----
  const warehouse = block.warehouse?.value;
  const parsed = parseWarehouseCodeResult(warehouse?.code);

  if (!parsed.ok) {
    ctx.blocker(
      'INBOND_EXBOND.WH_Code',
      `${describeWarehouseCodeError(parsed.error)} A ${label} Bill of Entry names the bonded ` +
        'warehouse it concerns, and Customs releases nothing against a code that is not one.',
    );
  } else {
    // The warehouse's licensing station and the station the BE is filed at are
    // separate facts, and they usually agree. When they do not, one of the two
    // was typed wrong, and the operator is the only one who can say which.
    const filedAt = draft.boe?.customStation?.value.code;
    if (filedAt && filedAt !== parsed.parsed.stationCode) {
      ctx.warn(
        'INBOND_EXBOND.WH_Code',
        `Warehouse ${parsed.parsed.code} is licensed under ${parsed.parsed.station.name} ` +
          `(${parsed.parsed.stationCode}) but this Bill of Entry is filed at ${filedAt}. ` +
          'That happens for a bond-to-bond movement and is a mistake otherwise — confirm which is right.',
      );
    }
  }

  if (parsed.ok && !warehouse?.name) {
    ctx.warn(
      'INBOND_EXBOND.WH_Name',
      `No name or address for warehouse ${parsed.parsed.code}. The code alone is valid for ICES, ` +
        'but Logi-Sys prints the warehouse on the checklist — enter it once on the job and it is ' +
        'kept for every later filing against this warehouse.',
    );
  }

  // ------------------------------------------------- the into-bond BE ----
  if (isExBond) {
    if (!block.inBondBeNo?.value) {
      ctx.blocker(
        'INBOND_EXBOND.InBond_BENo',
        'An ex-bond Bill of Entry releases goods deposited by an earlier into-bond Bill of Entry, ' +
          'and must name it. ICES will only release quantity its ledger holds against that BE, ' +
          'this importer’s IEC and this warehouse.',
      );
    }
    if (!block.inBondBeDate?.value) {
      ctx.blocker(
        'INBOND_EXBOND.InBond_BEDate',
        'The into-bond Bill of Entry’s date is mandatory on an ex-bond filing (BE Message format ' +
          '2.25, header field 34).',
      );
    }
    // How much is being released is the whole point of an ex-bond BE, and it
    // reaches the workbook through SHIPMENT and ITEMS rather than this sheet.
    // Without it the export would state the entire warehoused consignment,
    // which is a request to clear goods that are not being cleared.
    if (!block.release?.value) {
      ctx.blocker(
        'INBOND_EXBOND',
        'This ex-bond Bill of Entry does not say how much it releases. Warehoused goods leave in ' +
          'whole packages, and the BE declares the count and the gross weight of those packages — ' +
          'set them on the job.',
      );
    }
  } else if (block.inBondBeNo?.value) {
    // A W BE *is* the into-bond BE; it cannot draw against one.
    ctx.warn(
      'INBOND_EXBOND.InBond_BENo',
      'This is an into-bond Bill of Entry, so it creates the warehouse ledger rather than drawing ' +
        'against one. The into-bond BE number here is being written anyway — check it belongs.',
    );
  }

  // ------------------------------------------------------------ bond ----
  if (!block.bondNo?.value) {
    ctx.warn(
      'INBOND_EXBOND.Bond_No',
      'No warehousing bond number. Customs holds a bond against warehoused goods; Logi-Sys expects ' +
        'its number, date and expiry on this sheet.',
    );
  }

  // An expired bond is worth catching before the filing, not after.
  const expiry = block.bondExpiryDate?.value;
  if (expiry && expiry < new Date().toISOString().slice(0, 10)) {
    ctx.warn(
      'INBOND_EXBOND.Bond_ExpiryDate',
      `The warehousing bond expired on ${expiry}. Warehoused goods need a bond in force — check ` +
        'whether it has been extended.',
    );
  }

  // ------------------------------------------------------- section 65 ----
  // A section 65 warehouse is one goods are *manufactured* in, and what leaves
  // it is not always a resultant product: Circular 48/2020 para 8.1 lets
  // warehoused goods be cleared as such when no manufacture happened, with the
  // section 61 interest that a section 65 clearance does not attract, and
  // capital goods leave the premises the same way. Only the resultant-product
  // case carries SEC65_EXBOND_INFO rows — see map/sec65-exbond-info.ts.
  if (block.isSec65ManufacturingWh && isExBond) {
    switch (block.clearanceKind) {
      case undefined:
        ctx.warn(
          'INBOND_EXBOND.IsSEC65ManufacturingWH',
          'This releases goods from a section 65 warehouse, but the job does not say what it ' +
            'clears. A product manufactured in the warehouse is declared on SEC65_EXBOND_INFO ' +
            'with the GST invoice it was sold under; goods cleared as such are not, and carry ' +
            'section 61 interest instead. Say which on the job.',
        );
        break;
      case 'as_such':
      case 'capital_goods':
        ctx.warn(
          'INBOND_EXBOND.IsSEC65ManufacturingWH',
          'This clears goods from a section 65 warehouse without manufacture, so no finished ' +
            'product is declared. Interest under section 61 runs on such a clearance ' +
            '(Circular 48/2020, para 8.1) — check it has been reckoned into the duty.',
        );
        break;
      case 'job_work_return':
        ctx.warn(
          'INBOND_EXBOND.IsSEC65ManufacturingWH',
          'Imported inputs consumed in job work are duty-paid when the job-worked goods go back ' +
            'to the principal, but that return moves on a delivery challan rather than a GST ' +
            'invoice. Whether ICES still wants a SEC65 declaration here is unsettled — no rows ' +
            'are being written. Confirm before filing.',
        );
        break;
      case 'resultant_product':
        break;
    }
  } else if (block.isSec65ManufacturingWh && block.clearanceKind) {
    // A W BE deposits into the warehouse; nothing is being cleared out of it.
    ctx.warn(
      'INBOND_EXBOND',
      'This is an into-bond Bill of Entry, so it does not clear anything out of the section 65 ' +
        'warehouse. The clearance kind set on the job belongs to the later ex-bond filing.',
    );
  }

  return [
    {
      WH_Code: code(warehouse?.code),
      WH_Name: text(warehouse?.name),
      WH_Add1: text(warehouse?.address1),
      WH_Add2: text(warehouse?.address2),
      WH_City: text(warehouse?.city),
      // Kept as a code, not a number: a PIN with a leading zero is a real PIN.
      WH_PIN: code(warehouse?.pin),
      // The one honest constant on this sheet. A warehouse licensed under the
      // Customs Act, 1962 is in India by definition — there is no other kind.
      WH_Country: code(warehouse?.country ?? 'IN'),
      InBond_BENo: code(isExBond ? block.inBondBeNo?.value : undefined),
      InBond_BEDate: isExBond ? isoDate(block.inBondBeDate?.value) : BLANK,
      Bond_No: code(block.bondNo?.value),
      Bond_Date: isoDate(block.bondDate?.value),
      Bond_ExpiryDate: isoDate(block.bondExpiryDate?.value),
      // Y or blank, never N — the rule this workbook follows throughout.
      IsWareHouseSale: ynBlank(block.isWarehouseSale),
      IsSEC65ManufacturingWH: ynBlank(block.isSec65ManufacturingWh),
    },
  ];
}
