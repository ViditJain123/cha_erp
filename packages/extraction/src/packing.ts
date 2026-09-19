import type { PackingListExtract } from './schemas.js';
import type { DraftFlag, DraftItem, ItemPacking } from './draft.js';

/**
 * Matching a packing list's rows to the invoice's lines.
 *
 * A packing list and an invoice describe the same goods to different people, so
 * they rarely spell them the same way: "PP GRANULES NATURAL" against
 * "POLYPROPYLENE GRANULES (NATURAL)". Matching them is what turns a total into
 * a per-package weight, and a per-package weight is what makes a partial
 * ex-bond clearance computable — 10 bags at 255 kg gross is 25.5 kg a bag, so
 * releasing 4 bags is 102.0 kg.
 *
 * The discipline is the same one `resolveIndianStation` follows: a line that
 * matches nothing, or matches two items equally well, attaches nothing and
 * says so. A wrong per-package weight would put a wrong gross weight on a
 * customs declaration, and the operator can key the right one in a few seconds.
 */

/** Words that appear on both documents and identify neither. */
const NOISE =
  /\b(THE|OF|AND|WITH|GRADE|TYPE|QUALITY|PACKED|PACKING|IN|AS|PER|NEW|PRIME|VIRGIN|BULK|NOS|PCS|KGS?|MT|MTS|BAGS?|CARTONS?|DRUMS?|PALLETS?)\b/g;

/** The identifying words of a description, lower-cased and de-noised. */
function tokens(text: string): Set<string> {
  const cleaned = text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set(cleaned.split(' ').filter((t) => t.length > 1));
}

/**
 * Jaccard overlap of two descriptions, 0 to 1.
 *
 * Exported because matching a shipping bill's lines to the invoice's is the
 * same problem as matching a packing list's — two documents describing the same
 * goods to different readers — and it should not be solved twice.
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/**
 * How much overlap counts as the same goods.
 *
 * Deliberately not low. Two grades of the same polymer share most of their
 * words, and attaching bag weights to the wrong grade is worse than attaching
 * none: the operator sees an empty field and fills it, where a wrong figure
 * looks answered.
 */
const MIN_SIMILARITY = 0.5;

/** A tie this close is a tie — the descriptions do not separate the items. */
const TIE_EPSILON = 0.05;

function perPackage(total: number | null | undefined, packages: number): number | undefined {
  if (total === null || total === undefined || !Number.isFinite(total)) return undefined;
  if (packages <= 0) return undefined;
  // Six decimals: bag weights divide unevenly far more often than not, and the
  // released gross weight is written at three decimals downstream.
  return Number((total / packages).toFixed(6));
}

export interface PackingMatchResult {
  items: DraftItem[];
  flags: DraftFlag[];
}

/**
 * Attach each packing-list line to the item it describes.
 *
 * Returns new items rather than mutating, and a flag for every line it could
 * not place. A packing list with no per-product table produces no matches and
 * no complaints — plenty of them state only totals, and that is not an error.
 */
export function attachPacking(
  items: DraftItem[],
  packingList: PackingListExtract | undefined,
): PackingMatchResult {
  const lines = packingList?.lines ?? [];
  if (!packingList || lines.length === 0) return { items, flags: [] };

  const flags: DraftFlag[] = [];
  const attached = new Map<number, ItemPacking>();
  const claimedBy = new Map<number, string>();

  for (const line of lines) {
    if (!line.description?.trim()) continue;

    const scored = items
      .map((item) => ({ item, score: similarity(line.description, item.description) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < MIN_SIMILARITY) {
      flags.push({
        severity: 'warning',
        path: 'items.packing',
        message:
          `Packing list line "${line.description.slice(0, 60)}" does not match any invoice line, ` +
          'so its package count and weights were not used. Check whether the packing list covers ' +
          'goods the invoice does not.',
      });
      continue;
    }

    const tied = scored.filter((s) => best.score - s.score <= TIE_EPSILON);
    if (tied.length > 1) {
      flags.push({
        severity: 'warning',
        path: 'items.packing',
        message:
          `Packing list line "${line.description.slice(0, 60)}" describes ${tied.length} invoice ` +
          `lines equally well (${tied.map((t) => `#${t.item.slNo}`).join(', ')}), so its weights ` +
          'were not attached to any of them. Per-package weights for these items must be keyed in.',
      });
      continue;
    }

    const item = best.item;
    const already = claimedBy.get(item.slNo);
    if (already) {
      // Two packing rows for one invoice line — a shipment split across package
      // sizes. Summing them would give a per-package weight for a package size
      // that does not exist.
      flags.push({
        severity: 'warning',
        path: `items.${item.slNo}.packing`,
        message:
          `Invoice line #${item.slNo} matches more than one packing list row ("${already}" and ` +
          `"${line.description.slice(0, 40)}"), which usually means the goods are packed in more ` +
          'than one package size. No single per-package weight applies, so none was derived.',
      });
      attached.delete(item.slNo);
      continue;
    }
    claimedBy.set(item.slNo, line.description.slice(0, 40));

    const packages = line.packages;
    if (packages === null || packages === undefined || packages <= 0) {
      flags.push({
        severity: 'info',
        path: `items.${item.slNo}.packing`,
        message:
          `Packing list gives no package count for "${line.description.slice(0, 40)}", so no ` +
          'per-package weight could be derived for this item.',
      });
      continue;
    }

    attached.set(item.slNo, {
      packages,
      ...(line.packageType ? { packageType: line.packageType.toUpperCase() } : {}),
      ...(line.netWeightKg != null ? { netWeightKg: line.netWeightKg } : {}),
      ...(line.grossWeightKg != null ? { grossWeightKg: line.grossWeightKg } : {}),
      ...(perPackage(line.grossWeightKg, packages) !== undefined
        ? { perPackageGrossKg: perPackage(line.grossWeightKg, packages) as number }
        : {}),
      ...(perPackage(line.netWeightKg, packages) !== undefined
        ? { perPackageNetKg: perPackage(line.netWeightKg, packages) as number }
        : {}),
      sourceDescription: line.description,
    });
  }

  // The packing list's own totals are the check on the rows we just read. A
  // model that dropped a row, or read one figure twice, shows up here.
  const lineTotals = (pick: (l: (typeof lines)[number]) => number | null | undefined) =>
    lines.reduce<number | undefined>((sum, l) => {
      const v = pick(l);
      if (v === null || v === undefined) return sum;
      return (sum ?? 0) + v;
    }, undefined);

  const summedPackages = lineTotals((l) => l.packages);
  if (
    summedPackages !== undefined &&
    packingList.packageCount != null &&
    summedPackages !== packingList.packageCount
  ) {
    flags.push({
      severity: 'warning',
      path: 'items.packing',
      message:
        `The packing list's rows add up to ${summedPackages} packages but its total says ` +
        `${packingList.packageCount}. One of the rows was misread — check the per-package weights ` +
        'before relying on them for a partial clearance.',
    });
  }

  const summedGross = lineTotals((l) => l.grossWeightKg);
  if (summedGross !== undefined && packingList.grossWeightKg != null) {
    // Rounding on each printed row adds up, so this is a tolerance, not equality.
    const drift = Math.abs(summedGross - packingList.grossWeightKg);
    if (drift > Math.max(0.5, packingList.grossWeightKg * 0.001)) {
      flags.push({
        severity: 'warning',
        path: 'items.packing',
        message:
          `The packing list's rows add up to ${summedGross.toFixed(3)} kg gross but its total says ` +
          `${packingList.grossWeightKg.toFixed(3)} kg.`,
      });
    }
  }

  if (attached.size === 0) return { items, flags };

  return {
    items: items.map((item) => {
      const packing = attached.get(item.slNo);
      return packing ? { ...item, packing } : item;
    }),
    flags,
  };
}

/**
 * The gross weight of `packages` packages of an item.
 *
 * The arithmetic behind an ex-bond release: what leaves the bond is a whole
 * number of packages, and the Bill of Entry states what they weigh.
 */
export function releaseGrossWeight(item: DraftItem, packages: number): number | undefined {
  const per = item.packing?.perPackageGrossKg;
  if (per === undefined || !Number.isFinite(packages) || packages <= 0) return undefined;
  return Number((per * packages).toFixed(3));
}

/**
 * The goods quantity in `packages` packages of an item.
 *
 * Apportioned from the item's own invoice quantity by package share, because
 * that is the only relationship between the two documents that holds: the
 * packing list counts packages, the invoice counts the unit the duty is
 * assessed on, and 4 of 10 bags is four tenths of the quantity.
 */
export function releaseQuantity(item: DraftItem, packages: number): number | undefined {
  const total = item.packing?.packages;
  if (!total || total <= 0 || packages <= 0 || packages > total) return undefined;
  return Number(((item.quantity * packages) / total).toFixed(6));
}
