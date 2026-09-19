import 'server-only';
import { releaseGrossWeight, releaseQuantity } from '@checklist/extraction';
import type {
  ChecklistDraft,
  ExBondClearanceKind,
  ExBondRelease,
  GstTaxInvoiceExtract,
  InbondExbond,
  IntoBondBeExtract,
  Resolved,
  Sec65FinishedGood,
  WarehouseDetails,
} from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { recomputeDuty } from '@/lib/recompute';
import { resolveWarehouse } from '@/lib/warehouse';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Resolving the INBOND_EXBOND sheet — the warehouse a bonded Bill of Entry
 * concerns, and for an ex-bond filing, how much of it is leaving.
 *
 * Runs after `applyGeneralResolution`, because everything here is conditional
 * on a BE type that resolver settles. For a home-consumption BE it sets
 * nothing, and the sheet stays header-only.
 *
 * Same precedence as everywhere else: `document < master < mail < operator`.
 *
 * The one thing this does that the header resolver does not is **change the
 * goods**. An ex-bond BE declares the portion being released, not the whole
 * warehoused consignment, so a partial release rescales the items and the
 * invoice and recomputes duty. Doing it here rather than in the exporter keeps
 * one truth on the draft: what the job screen shows is what the workbook says
 * and what the duty was computed on.
 */

type BoeHeaderRow = Database['public']['Tables']['job_boe_header']['Row'];
type InstructionRow = Database['public']['Tables']['job_mail_instructions']['Row'];
type Sec65Row = Database['public']['Tables']['job_sec65_finished_goods']['Row'];

function resolved<T>(
  value: T,
  source: Resolved<T>['source'],
  because?: string,
  quote?: string,
): Resolved<T> {
  return { value, source, ...(because ? { because } : {}), ...(quote ? { quote } : {}) };
}

/** The into-bond BE a customer attached, when they attached one. */
function intoBondDoc(draft: ChecklistDraft): IntoBondBeExtract | undefined {
  // The draft carries only file names and doc types, so the extract itself is
  // read back from the job's documents by the caller. Kept as a parameter shape
  // rather than a lookup so this module stays testable.
  return (draft as { intoBondBe?: IntoBondBeExtract }).intoBondBe;
}

export interface InbondResolutionInput {
  draft: ChecklistDraft;
  companyId: string;
  jobId: string;
  /** The into-bond BE read off an attached document, when there is one. */
  intoBond?: IntoBondBeExtract | undefined;
  /** Outward GST tax invoices attached to a section 65 ex-bond clearance. */
  gstInvoices?: GstTaxInvoiceExtract[] | undefined;
}

/**
 * Fill `draft.inbondExbond`, and rescale the goods for a partial ex-bond
 * release.
 */
export async function applyInbondExbondResolution({
  draft,
  companyId,
  jobId,
  intoBond,
  gstInvoices,
}: InbondResolutionInput): Promise<ChecklistDraft> {
  const beType = draft.boe?.beType.value ?? draft.beType;

  // Not a bonded filing. Strip anything a previous resolution left behind — a
  // job whose BE type was corrected from EX to H must not keep its warehouse.
  if (beType === 'Home Consumption') {
    if (!draft.inbondExbond) return draft;
    const { inbondExbond: _dropped, ...rest } = draft;
    return { ...rest, flags: draft.flags.filter((f) => !f.path?.startsWith('inbond.')) };
  }

  const db = serviceClient();
  const [{ data: row }, { data: instructions }, { data: job }, { data: sec65Rows }] =
    await Promise.all([
      db
        .from('job_boe_header')
        .select('*')
        .eq('job_id', jobId)
        .eq('company_id', companyId)
        .maybeSingle(),
      db
        .from('job_mail_instructions')
        .select('*')
        .eq('job_id', jobId)
        .eq('company_id', companyId)
        .maybeSingle(),
      db
        .from('jobs')
        .select('into_bond_job_id')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .maybeSingle(),
      db
        .from('job_sec65_finished_goods')
        .select('*')
        .eq('job_id', jobId)
        .eq('company_id', companyId)
        .order('seq', { ascending: true }),
    ]);

  const header = row as BoeHeaderRow | null;
  const mail = instructions as InstructionRow | null;
  const attached = intoBond ?? intoBondDoc(draft);

  const flags: ChecklistDraft['flags'] = draft.flags.filter((f) => !f.path?.startsWith('inbond.'));
  const warn = (path: string, message: string) =>
    flags.push({ severity: 'warning', path: `inbond.${path}`, message });
  const info = (path: string, message: string) =>
    flags.push({ severity: 'info', path: `inbond.${path}`, message });

  // Where an ex-bond job inherits from, when it is linked to its into-bond job.
  const parentJobId = job?.into_bond_job_id ?? undefined;
  const parent = parentJobId ? await parentDraft(parentJobId, companyId) : undefined;

  // ------------------------------------------------------- warehouse ----
  //
  // Four sources, and only one of them is coded by us: the mail and the
  // attached BE give free text, the parent job gives an already-resolved code.
  const warehouseCandidate =
    header?.warehouse_code ??
    parent?.inbondExbond?.warehouse?.value.code ??
    attached?.warehouseCode ??
    mail?.warehouse_code ??
    mail?.warehouse ??
    undefined;

  const warehouseSource: Resolved<WarehouseDetails>['source'] = header?.warehouse_code
    ? 'operator'
    : parent?.inbondExbond?.warehouse
      ? 'master'
      : attached?.warehouseCode
        ? 'document'
        : 'mail';

  let warehouse: InbondExbond['warehouse'];
  // Section 65 is a fact about the warehouse, not about this filing. The
  // operator's tick on the job still wins, because they are the one holding the
  // permission — but the master is what it defaults from.
  let warehouseIsSec65: boolean | undefined;
  if (warehouseCandidate) {
    const resolution = await resolveWarehouse(warehouseCandidate, companyId);
    if (!resolution) {
      warn(
        'warehouse',
        `"${warehouseCandidate}" is not a warehouse code. A bonded warehouse code is 8 characters — ` +
          '4-character port, 1 type letter, 3-digit serial, as in MAA1U001. Set the right one on the job.',
      );
    } else {
      warehouseIsSec65 = resolution.isSec65;
      warehouse = resolved(
        resolution.warehouse,
        warehouseSource,
        resolution.source === 'icegate'
          ? 'Looked up on ICEGATE'
          : resolution.source === 'cache'
            ? 'Known warehouse'
            : `${resolution.parsed.type} warehouse under ${resolution.parsed.station.name}`,
        warehouseSource === 'mail' ? (mail?.warehouse_quote ?? undefined) : undefined,
      );
      if (resolution.source === 'code-only') {
        info(
          'warehouse',
          `Warehouse ${resolution.parsed.code} is valid — a ${resolution.parsed.type} warehouse ` +
            `under ${resolution.parsed.station.name} — but its name and address are not known. ` +
            'Enter them once on the job and they are kept for every later filing.',
        );
      }
    }
  } else {
    warn(
      'warehouse',
      `This is a ${beType === 'Ex-Bond' ? 'an ex-bond' : 'a warehousing'} Bill of Entry and no ` +
        'bonded warehouse has been named. It cannot be filed without one.',
    );
  }

  // -------------------------------------------------- the into-bond BE ----
  const inBondBeNo = pickResolved(
    [header?.inbond_be_no, 'operator', 'Entered on the job'],
    [parent?.boe ? parentBeNo(parent) : undefined, 'master', 'From the linked into-bond job'],
    [attached?.beNumber, 'document', 'Read off the attached into-bond Bill of Entry'],
    [mail?.inbond_be_no, 'mail', 'Named in the customer’s instructions', mail?.inbond_be_quote],
  );

  const inBondBeDate = pickResolved(
    [header?.inbond_be_date, 'operator', 'Entered on the job'],
    [attached?.beDate, 'document', 'Read off the attached into-bond Bill of Entry'],
  );

  if (beType === 'Ex-Bond' && !inBondBeNo) {
    warn(
      'inBondBeNo',
      'An ex-bond Bill of Entry must name the into-bond BE it draws against. Since 1 September 2025 ' +
        'ICES releases only what its ledger holds against that BE, this importer’s IEC and this ' +
        'warehouse — so a wrong or missing number is a refused release, not a warning on a checklist.',
    );
  }

  // ------------------------------------------------------------ bond ----
  const bondNo = pickResolved(
    [header?.bond_no, 'operator', 'Entered on the job'],
    [attached?.bondNo, 'document', 'Read off the attached into-bond Bill of Entry'],
    [mail?.bond_no, 'mail', 'Named in the customer’s instructions', mail?.bond_quote],
  );
  const bondDate = pickResolved(
    [header?.bond_date, 'operator', 'Entered on the job'],
    [attached?.bondDate, 'document', 'Read off the attached into-bond Bill of Entry'],
  );
  const bondExpiryDate = pickResolved(
    [header?.bond_expiry_date, 'operator', 'Entered on the job'],
    [attached?.bondExpiryDate, 'document', 'Read off the attached into-bond Bill of Entry'],
  );

  // ---------------------------------------------------------- release ----
  const release = beType === 'Ex-Bond' ? deriveRelease(draft, header, warn, info) : undefined;

  // -------------------------------------------------------- section 65 ----
  const isSec65 = header?.is_sec65_manufacturing_wh ?? warehouseIsSec65;
  const clearanceKind = (header?.exbond_clearance_kind ?? undefined) as
    | ExBondClearanceKind
    | undefined;
  // Operator over document, as everywhere: entries keyed on the job stand, and
  // an attached GST invoice only proposes when nobody has keyed anything.
  const keyed = (sec65Rows ?? []).map(finishedGoodFromRow);
  const proposed = keyed.length ? [] : finishedGoodsFromInvoices(gstInvoices ?? [], warn);
  const finishedGoods = keyed.length ? keyed : proposed;
  const finishedGoodsSource: Resolved<Sec65FinishedGood[]>['source'] = keyed.length
    ? 'operator'
    : 'document';

  if (beType === 'Ex-Bond' && isSec65) {
    if (!clearanceKind) {
      warn(
        'sec65',
        'This releases goods from a section 65 warehouse. What it clears decides the filing: a ' +
          'product manufactured in the warehouse is declared with the GST invoice it was sold ' +
          'under and attracts no interest, while goods cleared as such carry interest under ' +
          'section 61 (Circular 48/2020, para 8.1). Say which on the job.',
      );
    } else if (clearanceKind === 'resultant_product' && finishedGoods.length === 0) {
      warn(
        'sec65',
        'This clears a product manufactured in the warehouse, but no finished goods have been ' +
          'entered. ICES needs the GST invoice, the finished product’s own tariff heading and ' +
          'description, and the quantity cleared — none of which is on the import documents. ' +
          'The export refuses until they are entered.',
      );
    }
  } else if (clearanceKind && finishedGoods.length > 0) {
    // The BE type or the warehouse changed under a block somebody already
    // filled. Say so rather than quietly writing rows that no longer apply.
    info(
      'sec65',
      `${finishedGoods.length} finished-goods entr${finishedGoods.length === 1 ? 'y is' : 'ies are'} ` +
        'recorded on this job, but it is no longer a section 65 ex-bond clearance, so none of them ' +
        'will be declared.',
    );
  }

  const block: InbondExbond = {
    warehouse,
    inBondBeNo,
    inBondBeDate,
    bondNo,
    bondDate,
    bondExpiryDate,
    ...(header?.is_warehouse_sale != null ? { isWarehouseSale: header.is_warehouse_sale } : {}),
    ...(isSec65 != null ? { isSec65ManufacturingWh: isSec65 } : {}),
    ...(clearanceKind ? { clearanceKind } : {}),
    ...(finishedGoods.length
      ? {
          sec65FinishedGoods: resolved(
            finishedGoods,
            finishedGoodsSource,
            finishedGoodsSource === 'operator'
              ? 'Entered on the job'
              : 'Read off the attached GST tax invoice',
          ),
        }
      : {}),
    ...(release ? { release } : {}),
    ...(parentJobId ? { intoBondJobId: parentJobId } : {}),
  };

  const out: ChecklistDraft = { ...draft, inbondExbond: block, flags };

  // A partial release changes what is being declared, so it changes the goods.
  return release ? applyRelease(out, release.value, info) : out;
}

/**
 * Finished-goods entries proposed from the GST tax invoices a customer attached.
 *
 * One entry per goods line, because ICES declares a control row per finished
 * product rather than per invoice. What the document cannot say is which
 * imported inputs each product was made from — that is the unit's own
 * input-output norm, not something printed anywhere — so every proposal applies
 * to all the items, which is the ordinary MOOWR shape and the one the operator
 * narrows when it is wrong.
 *
 * Deliberately lenient about the CTH and the unit: a GST invoice prints HSN at
 * four or six digits and a unit of its own ("PCS", "MT"), neither of which is
 * what ICES takes. They are carried through as read, and the exporter refuses
 * the ones that are not valid — so the operator corrects a real value in the
 * field rather than being handed a silent guess.
 */
function finishedGoodsFromInvoices(
  invoices: GstTaxInvoiceExtract[],
  warn: (path: string, message: string) => void,
): Sec65FinishedGood[] {
  const out: Sec65FinishedGood[] = [];

  for (const invoice of invoices) {
    if (!invoice.invoiceNo || !invoice.invoiceDate) {
      warn(
        'sec65',
        'A GST tax invoice is attached but its number or date could not be read. Both are part of ' +
          'the section 65 declaration — check them on the job.',
      );
      continue;
    }
    for (const line of invoice.lines) {
      if (!line.description?.trim()) continue;
      out.push({
        gstInvoiceNo: invoice.invoiceNo.trim(),
        gstInvoiceDate: invoice.invoiceDate,
        cth: line.hsn?.trim() ?? '',
        description: line.description.trim(),
        quantity: line.quantity ?? 0,
        uqc: (line.unit ?? '').trim().toUpperCase(),
      });
    }
  }

  if (out.length) {
    warn(
      'sec65',
      `${out.length} finished-goods entr${out.length === 1 ? 'y was' : 'ies were'} read off the ` +
        'attached GST tax invoice. A GST invoice prints HSN at four or six digits and its own ' +
        'unit of measure, neither of which ICES accepts — check the tariff heading and the unit ' +
        'on each before exporting.',
    );
  }
  return out;
}

/**
 * One stored finished-goods row as the draft wants it.
 *
 * `applies_to_items` is null for the ordinary case — one resultant product made
 * from every input on the BE — and the draft says the same thing by leaving
 * `itemSrNos` off entirely rather than by listing every serial.
 */
function finishedGoodFromRow(row: Sec65Row): Sec65FinishedGood {
  return {
    gstInvoiceNo: row.gst_invoice_no,
    gstInvoiceDate: row.gst_invoice_date,
    cth: row.finished_cth,
    description: row.finished_desc,
    quantity: Number(row.finished_qty),
    uqc: row.finished_uqc,
    ...(row.applies_to_items?.length ? { itemSrNos: row.applies_to_items } : {}),
  };
}

/** The first source that has a value, with its provenance. */
function pickResolved(
  ...candidates: [
    string | null | undefined,
    Resolved<string>['source'],
    string,
    (string | null | undefined)?,
  ][]
): Resolved<string> | undefined {
  for (const [value, source, because, quote] of candidates) {
    if (value) return resolved(value, source, because, quote ?? undefined);
  }
  return undefined;
}

/** The into-bond BE number recorded on a linked parent job's own draft. */
function parentBeNo(parent: ChecklistDraft): string | undefined {
  return parent.inbondExbond?.inBondBeNo?.value;
}

/** The latest draft of a linked into-bond job. */
async function parentDraft(
  jobId: string,
  companyId: string,
): Promise<ChecklistDraft | undefined> {
  const db = serviceClient();
  const { data } = await db
    .from('job_drafts')
    .select('draft')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.draft as unknown as ChecklistDraft) ?? undefined;
}

/**
 * How much this ex-bond BE releases.
 *
 * The operator says how many packages. The weight follows from the packing
 * list, because a package's weight is the one thing the two documents together
 * can establish: 10 bags at 255 kg gross is 25.5 kg a bag, so 4 bags is 102.0 kg.
 * A weight the operator keyed wins over a derived one — they can see the goods.
 */
function deriveRelease(
  draft: ChecklistDraft,
  header: BoeHeaderRow | null,
  warn: (path: string, message: string) => void,
  info: (path: string, message: string) => void,
): Resolved<ExBondRelease> | undefined {
  const packages = header?.released_packages ?? undefined;
  if (!packages) return undefined;

  const totalPackages = draft.items.reduce((sum, i) => sum + (i.packing?.packages ?? 0), 0);
  if (totalPackages && packages > totalPackages) {
    warn(
      'release',
      `This BE releases ${packages} packages but the packing list accounts for only ${totalPackages}. ` +
        'ICES will refuse a release larger than its ledger holds.',
    );
  }

  // Apportion the packages across items by their share of the total, then let
  // each item's own per-package weight do the arithmetic.
  const items = draft.items
    .filter((i) => i.packing?.packages)
    .map((i) => {
      const share = totalPackages ? (i.packing!.packages / totalPackages) * packages : 0;
      const itemPackages = Math.round(share);
      return {
        slNo: i.slNo,
        quantity: releaseQuantity(i, itemPackages) ?? 0,
        packages: itemPackages,
      };
    })
    .filter((i) => i.packages > 0);

  const derivedGross = draft.items.reduce<number | undefined>((sum, i) => {
    const forItem = items.find((x) => x.slNo === i.slNo);
    if (!forItem) return sum;
    const w = releaseGrossWeight(i, forItem.packages);
    return w === undefined ? sum : (sum ?? 0) + w;
  }, undefined);

  const keyedGross = header?.released_gross_weight_kg
    ? Number(header.released_gross_weight_kg)
    : undefined;
  const grossWeightKg = keyedGross ?? (derivedGross !== undefined ? Number(derivedGross.toFixed(3)) : undefined);

  if (keyedGross === undefined && derivedGross === undefined) {
    warn(
      'release',
      `No gross weight for the ${packages} package(s) being released: the packing list gives no ` +
        'per-package weight for these goods. Key the released weight on the job.',
    );
  } else if (keyedGross !== undefined && derivedGross !== undefined) {
    const drift = Math.abs(keyedGross - derivedGross);
    if (drift > Math.max(0.5, derivedGross * 0.01)) {
      warn(
        'release',
        `The released weight entered (${keyedGross} kg) differs from what the packing list implies ` +
          `for ${packages} package(s) (${derivedGross.toFixed(3)} kg). The entered figure is being used.`,
      );
    }
  } else if (derivedGross !== undefined) {
    info(
      'release',
      `Released weight ${derivedGross.toFixed(3)} kg, from the packing list's per-package weights ` +
        `for ${packages} package(s).`,
    );
  }

  const packageCode =
    header?.released_package_code ??
    draft.items.find((i) => i.packing?.packageType)?.packing?.packageType ??
    draft.shipment.packageUnit;

  return resolved(
    {
      packages,
      ...(packageCode ? { packageCode } : {}),
      ...(grossWeightKg !== undefined ? { grossWeightKg } : {}),
      ...(header?.released_uom ? { unit: header.released_uom } : { unit: 'KGS' }),
      ...(items.length ? { items } : {}),
      ...(keyedGross === undefined ? { derived: true } : {}),
    },
    'operator',
    `${packages} package(s) released from the warehouse`,
  );
}

/**
 * Rescale the goods to the portion being released.
 *
 * An ex-bond Bill of Entry is a declaration about 50 kg, not about the 200 kg
 * that went into the warehouse — the duty assessed is the duty on what leaves.
 * Both quantity and amount move together, which is what keeps the ITEMS sheet's
 * `quantity × unit price = amount` invariant true, and duty is recomputed
 * because the assessable value has changed underneath it.
 */
function applyRelease(
  draft: ChecklistDraft,
  release: ExBondRelease,
  info: (path: string, message: string) => void,
): ChecklistDraft {
  if (!release.items?.length) return draft;

  const scaled = draft.items.map((item) => {
    const forItem = release.items!.find((r) => r.slNo === item.slNo);
    if (!forItem || forItem.quantity <= 0 || forItem.quantity >= item.quantity) return item;
    const ratio = forItem.quantity / item.quantity;
    return {
      ...item,
      quantity: forItem.quantity,
      // The unit price is unchanged — it is a price, not a total — so the
      // amount follows the quantity and the invariant holds.
      amount: Number((item.amount * ratio).toFixed(2)),
    };
  });

  const changed = scaled.some((s, i) => s.quantity !== draft.items[i]!.quantity);
  if (!changed) return draft;

  info(
    'release',
    'The item quantities and values on this Bill of Entry are the portion being released from the ' +
      'warehouse, not the whole warehoused consignment. Duty has been recomputed on them.',
  );

  return recomputeDuty({ ...draft, items: scaled });
}
