import { igstRateForCth } from './index.js';
import { tariffBook, type TariffBookRow } from './tariff-book.js';

/**
 * The printed tariff checked against CBIC's own notifications.
 *
 * The tariff book is a commercial secondary source. CBIC's notifications are
 * the primary one, and the repo already parses two of them —
 * 9/2025-Integrated Tax (Rate) for IGST and 45/2025-Customs for BCD
 * concessions. Where the two agree, a rate has been read independently twice
 * off different documents by different parsers, which is far better evidence
 * than either alone. Where they disagree, **CBIC wins** and the book's reading
 * is recorded rather than discarded, because a disagreement is a fact about
 * our own parse as much as about the book: it is the only signal that will
 * catch a mis-OCR'd digit the arithmetic checksum cannot, since nothing on the
 * printed row constrains the statutory BASIC column.
 *
 * This lives in TypeScript rather than in build-tariff-book.py deliberately.
 * The comparison needs `specMatch` — how a notification's column-(2) code
 * spec covers a CTH, with longest-prefix precedence and exclusions — and
 * reimplementing that in the build script would leave two copies of the rule
 * free to drift apart. The build owns the parse; this owns the reconciliation.
 */

export interface TariffDissent {
  field: 'igstRate';
  /** What CBIC's notification says, which is what the pipeline will use. */
  cbic: number;
  /** What the book prints. Recorded, not applied. */
  book: number;
  /** Where CBIC says it. */
  notification: string;
  serial: string;
  /** Where the book says it. */
  page: number;
}

export type Corroboration =
  | 'corroborated'
  | 'gap-filled'
  | 'description-decided'
  | 'exempt-in-book'
  | 'disputed';

/**
 * Words that make a notification entry turn on what the goods *are* rather than
 * on what code they bear.
 *
 * This is the difference between the two sources and it has to be respected or
 * the comparison is nonsense. `igstRateForCth` matches on code alone, so for
 * heading 0203 it returns 9/2025 Schedule I S.No. 2 at 5% — an entry whose
 * description reads "All goods, **other than** fresh or chilled, pre-packaged
 * and labelled". The book prints 0% against fresh chilled pork, and the book is
 * right: the entry excludes those goods, and nothing in a code lookup can see
 * it. Treated naively this one pattern alone produced 3,106 "disputes", almost
 * all of them false.
 *
 * A row whose CBIC entry carries one of these is not a conflict between
 * sources. It is a question only the goods description answers, which is what
 * notification-choose.ts asks the model.
 */
const DESCRIPTION_QUALIFIERS = [
  'other than',
  'except',
  'excluding',
  'pre-packaged',
  'prepackaged',
  'pre-packed',
  'fresh or chilled',
  'not elsewhere',
  'for use in',
  'intended for',
  'of a kind used',
  'all goods other',
  'put up in',
  'not exceeding',
  'exceeding',
];

function turnsOnDescription(description: string): boolean {
  const text = description.toLowerCase();
  return DESCRIPTION_QUALIFIERS.some((q) => text.includes(q));
}

export interface CrossCheck {
  cth: string;
  status: Corroboration;
  dissent: TariffDissent[];
}

/**
 * Compare one parsed row against the notification masters.
 *
 * A residual IGST answer is not corroboration: 9/2025 sets rates, and goods it
 * nowhere names fall to Schedule II's 18% by default. Comparing the book
 * against a default would manufacture agreement where nobody has spoken, so
 * those rows come back `gap-filled` — which is the honest description of a
 * rate only the book states.
 */
export function crossCheckRow(row: TariffBookRow): CrossCheck {
  const dissent: TariffDissent[] = [];
  let compared = false;
  let deferred = false;

  const igst = igstRateForCth(row.cth);
  if (row.igstRate !== undefined && igst && !igst.residual) {
    if (turnsOnDescription(igst.entry.description) || igst.alternatives.length) {
      // Equally specific entries naming different rates are the same problem:
      // the code cannot separate them, so neither can this.
      deferred = true;
    } else {
      compared = true;
      if (Math.abs(igst.rate - row.igstRate) > 0.001) {
        dissent.push({
          field: 'igstRate',
          cbic: igst.rate,
          book: row.igstRate,
          notification: igst.notification,
          serial: `${igst.entry.schedule}${igst.entry.serial}`,
          page: row.page,
        });
      }
    }
  }

  // A disagreement where the book says nil and CBIC says a rate is not the two
  // sources conflicting — it is a known hole in ours. 9/2025 sets rates; goods
  // that are nil-rated are exempted by the companion IGST exemption
  // notification, which the masters do not carry (merge.ts says the same thing
  // when it meets a residual answer). Every one of the 125 such rows runs that
  // way and none runs the other, which is what a systematic gap looks like
  // rather than a parse error. Kept separate so the 87 real conflicts are
  // visible instead of buried under them.
  const exemptInBook =
    dissent.length > 0 && dissent.every((d) => d.book === 0 && d.cbic > 0);

  const status: Corroboration = exemptInBook
    ? 'exempt-in-book'
    : dissent.length
      ? 'disputed'
      : compared
        ? 'corroborated'
        : deferred
          ? 'description-decided'
          : 'gap-filled';
  return { cth: row.cth, status, dissent };
}

export interface CrossCheckReport {
  checked: number;
  corroborated: number;
  gapFilled: number;
  /** The goods description decides, so the two sources were never comparable. */
  descriptionDecided: number;
  /** Book says nil against a rated CBIC entry — the IGST exemption notification we lack. */
  exemptInBook: number;
  /** Both sources state a rate and they differ. These need a human. */
  disputed: number;
  /** Agreement among the rows where both sources actually speak. */
  agreement: number;
  rows: CrossCheck[];
}

let cached: CrossCheckReport | null | undefined;

/** Every parsed row checked against the notification masters, memoised. */
export function crossCheckTariffBook(): CrossCheckReport | null {
  if (cached !== undefined) return cached;
  const file = tariffBook();
  if (!file) {
    cached = null;
    return null;
  }
  const rows = file.rows.map(crossCheckRow);
  const corroborated = rows.filter((r) => r.status === 'corroborated').length;
  const disputed = rows.filter((r) => r.status === 'disputed').length;
  const spoken = corroborated + disputed;
  cached = {
    checked: rows.length,
    corroborated,
    gapFilled: rows.filter((r) => r.status === 'gap-filled').length,
    descriptionDecided: rows.filter((r) => r.status === 'description-decided').length,
    exemptInBook: rows.filter((r) => r.status === 'exempt-in-book').length,
    disputed,
    agreement: spoken ? corroborated / spoken : 0,
    rows,
  };
  return cached;
}

let byCth: Map<string, TariffDissent[]> | null = null;

/**
 * Where CBIC and the book disagree for one CTH.
 *
 * Empty for the overwhelming majority, which is the point: the pipeline can
 * raise a flag on exactly the lines where two sources conflict, instead of
 * warning on every line that a secondary source was involved.
 */
export function tariffDissent(cth: string): TariffDissent[] {
  if (!byCth) {
    byCth = new Map();
    for (const row of crossCheckTariffBook()?.rows ?? []) {
      // Only genuine conflicts. Surfacing the exemption gap here would put a
      // warning on every line of fresh produce on every job.
      if (row.status === 'disputed') byCth.set(row.cth, row.dissent);
    }
  }
  return byCth.get(cth.replace(/\D/g, '').slice(0, 8)) ?? [];
}
