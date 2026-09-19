import { VALID_UQC, lookupTariff, pad8 } from '@checklist/core';
import type { Sec65FinishedGood } from '@checklist/extraction';
import { code, int, isoDate, qty, text } from '../cell.js';
import type { SheetRow } from '../sheet-writer.js';
import type { MapContext } from './context.js';

/**
 * SEC65_EXBOND_INFO — the finished product cleared out of a Section 65
 * warehouse, and the GST invoice it was sold under.
 *
 * Section 65 of the Customs Act lets the owner of warehoused goods manufacture
 * in the warehouse (MOOWR 2019). When the resultant product is supplied into
 * the domestic tariff area it moves under a GST invoice and the duty on the
 * imported inputs contained in it falls due, so an ex-bond BE is filed whose
 * *items are the inputs* while this sheet declares the *output*. None of it is
 * derivable from the import documents, which is why every value here is an
 * operator or document fact — `docs/boe-mapping/08-sec65-exbond-info.md`.
 *
 * ICES carries this as `BE_ITEM_SW_CTRL` with Control Type Code `SEC65`
 * (`BE Message format 2.25`, CACHI01 Part 22/24). Of its seventeen fields
 * Logi-Sys asks for eight; it supplies the constant `SEC65` itself, takes
 * Control Location from the warehouse code on INBOND_EXBOND, leaves Control
 * Start Date (the warehousing date) to ICES, which holds it against the
 * into-bond BE, and numbers Control Slno from the order rows arrive in. That
 * last one is why rows for the same item must be contiguous and ordered here:
 * it is the only thing that distinguishes two GST invoices against one item,
 * and a collision is ICES error 733.
 *
 * The rejections this mapper exists to make impossible are real ones, from
 * `data/customs-corpus/icegate-specs/BE_fresh_filing_error_codes_24032026.pdf`:
 * 725 warehouse code null, 728 invalid GST invoice number, 729 invalid date,
 * 730 invalid CTH, 731 quantity null or negative, 732 invalid UQC, 733 duplicate
 * Slno, 734 control row against an item that does not exist, 735 an item with no
 * control row, 868 SEC65 details on a BE that is not a Section 65 ex-bond.
 */
export function sec65ExbondInfoRows(ctx: MapContext): SheetRow[] {
  const { draft } = ctx;
  const beType = draft.boe?.beType.value ?? draft.beType;
  const block = draft.inbondExbond;

  // ---------------------------------------------------------- the gate ----
  // ICES error 868: these rows are only ever valid on a Section 65 ex-bond BE
  // clearing a resultant product. Everything else leaves the sheet header-only,
  // byte for byte as the vendor shipped it.
  if (beType !== 'Ex-Bond' || !block) return [];
  if (block.clearanceKind !== 'resultant_product') return [];

  if (block.isSec65ManufacturingWh !== true) {
    ctx.blocker(
      'SEC65_EXBOND_INFO',
      'This Bill of Entry is set to clear a product manufactured in the warehouse, but the ' +
        'warehouse is not marked as holding a section 65 permission. ICES validates the ' +
        'declaration against its own IEC-to-warehouse mapping and rejects it otherwise — ' +
        'confirm the MOOWR permission on the warehouse, or change what this filing clears.',
    );
  }

  const entries = block.sec65FinishedGoods?.value ?? [];
  if (entries.length === 0) {
    ctx.blocker(
      'SEC65_EXBOND_INFO',
      'A section 65 clearance declares the finished product it is selling: the GST invoice it ' +
        'moves under, that product’s own tariff heading and description, and the quantity ' +
        'cleared. None of it appears on the import documents, and ICES refuses the filing ' +
        'without it — enter the finished goods on the job.',
    );
    return [];
  }

  // Control Location is not a column on this sheet — Logi-Sys reads it off
  // INBOND_EXBOND — but a blank one there makes every row here invalid
  // (ICES error 725), and the operator should hear it against this sheet too.
  if (!block.warehouse?.value.code) {
    ctx.blocker(
      'SEC65_EXBOND_INFO',
      'The section 65 declaration names the warehouse the goods were manufactured in, and this ' +
        'Bill of Entry has no warehouse code. ICES rejects a SEC65 control row with no location.',
    );
  }
  // Control Start Date is the warehousing date, which ICES holds against the
  // into-bond BE rather than reading from us. It cannot look it up without one.
  if (!block.inBondBeDate?.value) {
    ctx.warn(
      'SEC65_EXBOND_INFO',
      'The into-bond Bill of Entry’s date is not known. ICES fills the section 65 declaration’s ' +
        'warehousing date from that BE, and rejects the filing when it cannot (error 727).',
    );
  }

  const itemSerials = draft.items.map((item) => item.slNo);
  const invoiceOf = new Map(draft.items.map((item) => [item.slNo, item.invoiceSrNo]));

  // ------------------------------------------------- per-entry validation ----
  const targetsByEntry = entries.map((entry, i) =>
    validateEntry(ctx, entry, i, itemSerials, block.inBondBeDate?.value),
  );

  // ----------------------------------------------------------- fan out ----
  // Grouped by item so each item's rows are contiguous: Logi-Sys numbers
  // Control Slno positionally, and an item's second GST invoice has to land
  // immediately after its first to get Slno 2 rather than colliding.
  const rows: SheetRow[] = [];
  for (const slNo of itemSerials) {
    const seen = new Set<string>();
    let declared = 0;

    entries.forEach((entry, i) => {
      if (!targetsByEntry[i]!.has(slNo)) return;
      declared += 1;

      // ICES error 733: two rows for one item cannot both be the same GST
      // invoice, because they would be the same control record twice.
      const key = entry.gstInvoiceNo.trim().toUpperCase();
      if (seen.has(key)) {
        ctx.blocker(
          `SEC65_EXBOND_INFO[${i}]`,
          `GST invoice ${entry.gstInvoiceNo} is declared twice against item ${slNo}. ICES numbers ` +
            'each control row for an item in turn and refuses a repeat.',
        );
        return;
      }
      seen.add(key);

      rows.push({
        Inv_SrNo: int(invoiceOf.get(slNo)),
        Item_SrNo: int(slNo),
        GSTInvoiceNo: code(entry.gstInvoiceNo.trim()),
        GSTInvoiceDate: isoDate(entry.gstInvoiceDate),
        // Eight digits. Logi-Sys joins this and the description into ICES's
        // single Control Result Text field with its own delimiter.
        FinishedProductCTH: code(pad8(entry.cth)),
        FinishedProductDesc: text(entry.description),
        // Six decimals: ICES declares Control MSR as N(16,6), and it is the
        // convention the ITEMS quantities already follow. The vendor has never
        // shipped a populated example of this sheet, so this is the spec's
        // precision, not an observed one.
        FinishedProductQty: qty(entry.quantity),
        FinishedProductQtyUnit: code(entry.uqc.trim().toUpperCase()),
      });
    });

    // ICES error 735: every item on a section 65 ex-bond BE needs a control
    // row. An input with no finished product against it is either an input the
    // operator forgot to allocate, or a line that does not belong on this BE.
    if (declared === 0) {
      ctx.blocker(
        'SEC65_EXBOND_INFO',
        `Item ${slNo} has no finished product declared against it. ICES requires a section 65 ` +
          'declaration for every item on the Bill of Entry — either allocate this input to one ' +
          'of the finished goods, or take the line off the filing.',
      );
    }
  }

  return rows;
}

/**
 * Checks one finished-goods entry and returns the item serials it applies to.
 *
 * Each check is an ICES rejection we would otherwise discover after filing.
 */
function validateEntry(
  ctx: MapContext,
  entry: Sec65FinishedGood,
  index: number,
  itemSerials: number[],
  warehousingDate: string | undefined,
): Set<number> {
  const path = `SEC65_EXBOND_INFO[${index}]`;
  const label = entry.gstInvoiceNo?.trim() || `entry ${index + 1}`;

  // ---- GST invoice number (ICES error 728) ----
  const invoiceNo = entry.gstInvoiceNo?.trim() ?? '';
  if (!invoiceNo) {
    ctx.blocker(
      `${path}.GSTInvoiceNo`,
      'A section 65 clearance has no meaning without the GST invoice the finished product was ' +
        'sold under — it is the record ICES matches the declaration against.',
    );
  } else if (invoiceNo.length > 16) {
    ctx.blocker(
      `${path}.GSTInvoiceNo`,
      `GST invoice number "${invoiceNo}" is ${invoiceNo.length} characters. ICES holds it in ` +
        'sixteen, which is also the most a GST invoice serial may be under rule 46 — so a longer ' +
        'one is a transcription error, not a long invoice number.',
    );
  }

  // ---- GST invoice date (ICES error 729) ----
  if (!entry.gstInvoiceDate) {
    ctx.blocker(`${path}.GSTInvoiceDate`, `No date for GST invoice ${label}.`);
  } else {
    // The BE has no date of its own yet — ICES assigns it on filing — so today
    // is the only upper bound there is, and a future-dated invoice is a typo.
    const today = new Date().toISOString().slice(0, 10);
    if (entry.gstInvoiceDate > today) {
      ctx.warn(
        `${path}.GSTInvoiceDate`,
        `GST invoice ${label} is dated ${entry.gstInvoiceDate}, in the future. The duty falls due ` +
          'when the finished product is supplied, so the invoice cannot postdate the filing.',
      );
    }
    if (warehousingDate && entry.gstInvoiceDate < warehousingDate) {
      ctx.warn(
        `${path}.GSTInvoiceDate`,
        `GST invoice ${label} is dated ${entry.gstInvoiceDate}, before the goods were warehoused ` +
          `(into-bond BE ${warehousingDate}). The finished product cannot have been sold before ` +
          'its inputs reached the warehouse.',
      );
    }
  }

  // ---- finished product CTH (ICES error 730) ----
  const cth = pad8(entry.cth);
  if (!cth) {
    ctx.blocker(
      `${path}.FinishedProductCTH`,
      `No tariff heading for the finished product on GST invoice ${label}. It is the finished ` +
        'product’s own CTH, which is rarely the CTH of any input it was made from.',
    );
  } else if (!lookupTariff(cth)) {
    ctx.blocker(
      `${path}.FinishedProductCTH`,
      `CTH ${cth} is not a tariff item in the Customs Tariff first schedule. ICES validates the ` +
        'heading inside the section 65 declaration and refuses one it does not hold.',
    );
  }

  if (!entry.description?.trim()) {
    ctx.blocker(
      `${path}.FinishedProductDesc`,
      `No description of the finished product on GST invoice ${label}. ICES carries the heading ` +
        'and the description together in one field and expects both.',
    );
  }

  // ---- quantity (ICES error 731) ----
  if (!Number.isFinite(entry.quantity) || entry.quantity <= 0) {
    ctx.blocker(
      `${path}.FinishedProductQty`,
      `The quantity cleared under GST invoice ${label} must be a positive number. This is how ` +
        'much finished product left the warehouse, in its own unit — not the quantity of any input.',
    );
  }

  // ---- UQC (ICES error 732) ----
  // Deliberately not normalizeUqc(): that one falls back to NOS for an unknown
  // unit, and a silently defaulted unit on a customs declaration is the thing
  // this mapping contract exists to prevent.
  const uqc = entry.uqc?.trim().toUpperCase() ?? '';
  if (!uqc) {
    ctx.blocker(`${path}.FinishedProductQtyUnit`, `No unit for the quantity on GST invoice ${label}.`);
  } else if (!VALID_UQC.has(uqc)) {
    ctx.blocker(
      `${path}.FinishedProductQtyUnit`,
      `"${uqc}" is not an ICES unit quantity code. The section 65 declaration takes one of ` +
        `${[...VALID_UQC].join(', ')} — pick the one the GST invoice's quantity is actually in.`,
    );
  }

  // ---- which items this applies to (ICES error 734) ----
  if (!entry.itemSrNos) return new Set(itemSerials);

  const known = new Set(itemSerials);
  const unknown = entry.itemSrNos.filter((slNo) => !known.has(slNo));
  if (unknown.length) {
    ctx.blocker(
      `${path}.Item_SrNo`,
      `GST invoice ${label} is declared against item${unknown.length > 1 ? 's' : ''} ` +
        `${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not on this Bill of ` +
        'Entry. A control row has to point at an item that exists.',
    );
  }
  return new Set(entry.itemSrNos.filter((slNo) => known.has(slNo)));
}
