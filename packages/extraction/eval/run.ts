/**
 * Extraction eval: run the full pipeline on the raw docs of the two reference
 * jobs (the checklist PDFs themselves are excluded — they are the answer key)
 * and diff key outcomes against expectations transcribed from those checklists.
 *
 * Usage: OPENAI_API_KEY=... pnpm eval [jobDir ...]
 *
 * Two classes of check are reported but deliberately **not scored**, because
 * they need a company and a database that this synchronous, tenant-free harness
 * does not have: the importer's GSTIN (filled by `applyPartyResolution`) and,
 * on an EXW/FOB job, the duty payable (which needs the importer's marine
 * open-policy insurance rate off the organization record). Both print with a
 * label saying so. Everything else is scored, and a red line is a real
 * regression.
 *
 * The SHIPMENT block below is the reason this file matters: the golden exporter
 * tests run off hand-transcribed drafts, so they pin the mapper and can never
 * catch an extraction regression. These are the only assertions that read the
 * real PDFs.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  normalizePackageUnit,
  normaliseContainerNumber,
  parseContainerSizeType,
  termsOfPayment,
} from '@checklist/core';
import { runPipeline } from '../src/index.js';
import type { ChecklistDraft } from '../src/index.js';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * What the SHIPMENT sheet should end up carrying.
 *
 * The golden exporter tests run off hand-transcribed drafts, so they pin the
 * mapper and can never catch an extraction regression. These are the only
 * assertions that read the real PDFs, which makes them the only thing standing
 * between a prompt change and a silently emptier SHIPMENT tab.
 */
interface ShipmentExpectation {
  blNo?: string;
  blDate?: string;
  mawbNo?: string;
  hawbNo?: string;
  carrier?: string;
  vessel?: string;
  voyageNo?: string;
  packageCount?: number;
  packageUnit?: string;
  grossWeightKg?: number;
  netWeightKg?: number;
  marksAndNos?: string;
  /**
   * The CONTAINERS sheet, which nothing scored until every export in the corpus
   * had come out carrying one container. Three of the five jobs below really do
   * move a single box — they are here so a fix for the four- and six-container
   * jobs cannot pass by inventing containers.
   */
  containers?: { count: number; numbers?: string[]; sizes?: string[] };
}

interface Expectation {
  transportMode: string;
  importerGstin?: string;
  /** The FIRST invoice's number. `invoiceCount` asserts that the rest arrived. */
  invoiceNumber?: string;
  /**
   * How many invoices the Bill of Entry declares.
   *
   * `ex_job5` is twelve. Until the pipeline carried more than one, that job
   * scored a pass on the first invoice's number while eleven declarations went
   * missing, and nothing in the harness could see it.
   */
  invoiceCount?: number;
  toi?: string;
  /** Charges on the first invoice that are not for goods, in its own currency. */
  miscCharges?: number;
  termsOfPayment?: string;
  natureOfTransaction?: string;
  ritc?: string;
  shipment?: ShipmentExpectation;
  /** Null means "read it but do not assert it"; absent means the job has no duty expectation. */
  totalAssessableValue?: number | null;
  dutyPayable?: number | null;
  dutyComputed?: boolean;
  ftaScheme?: string;
  /**
   * ITEMS (docs/boe-mapping/06-items.md): how many lines, and what the
   * checklist Logi-Sys printed for chosen ones. Serials are the point — a
   * notification number with the wrong serial files a different exemption.
   */
  items?: {
    count?: number;
    lines?: {
      index: number;
      ritc?: string;
      aidcSerial?: string;
      igstSerial?: string;
      basic?: { notification: string; serial: string };
      fta?: { slot: 'BASIC' | 'SAPTA'; notification: string; serial: string };
    }[];
  };
  note?: string;
}

const EXPECTATIONS: Record<string, Expectation> = {
  ex_job1: {
    // ITEMS: two lines of lubricating preparation, both on the tariff rate.
    items: { count: 2, lines: [{ index: 0, ritc: '34039900', aidcSerial: '17', igstSerial: 'II68' }] },
    transportMode: 'Air',
    importerGstin: '27AABCB0983D1ZY',
    invoiceNumber: 'INV00000208940',
    invoiceCount: 1,
    toi: 'C&F',
    // Line 3 of the invoice is "FREIGHT-CHARGE $590.75", so the subtotal is
    // 15,874.59 and the goods are 15,283.84. Logi-Sys filed exactly that split:
    // Invoice Value 15283.84 USD, Misc. Charges 590.75 USD.
    miscCharges: 590.75,
    ritc: '34039900',
    // Air. The carrier is Air France off the MAWB prefix 057, not the issuing
    // agent DSV AIR & SEA INC that the waybill names. Neither waybill states a
    // package kind, so `packageUnit` is deliberately not asserted — the
    // checklist's "1 PLT" came from a person.
    shipment: {
      mawbNo: '05779606800',
      hawbNo: 'BOS0121016',
      blDate: '2026-06-30',
      carrier: 'AIR FRANCE',
      packageCount: 1,
      grossWeightKg: 101,
      marksAndNos: '05779606800\n................\nBOS0121016',
    },
    // Insurance now auto-applies from the importer's marine open-policy rate
    // (0.0118% of C&F) — AV lands within a paisa, duty payable exactly.
    totalAssessableValue: null,
    dutyPayable: 419_638,
    dutyComputed: true,
  },
  ex_job2: {
    // ITEMS: DFTP on Ugandan lactose files in the SAPTA slot, not Basic.
    items: {
      count: 1,
      lines: [{ index: 0, ritc: '17021110', aidcSerial: '17', igstSerial: 'I106', fta: { slot: 'SAPTA', notification: '096/2008', serial: '(i)' } }],
    },
    transportMode: 'Sea',
    importerGstin: '07AAFCF4316C1Z3',
    invoiceNumber: 'BFL/2026-27/038',
    invoiceCount: 1,
    toi: 'CIF',
    ritc: '17021110',
    totalAssessableValue: 2_859_000,
    dutyPayable: 142_950,
    ftaScheme: 'Duty Free Tariff Preference Scheme for Least Developed Countries',
    // The B/L prints three competing numbers — BOOKING NO ESLKEMBFL2000990, an
    // illegible BL No. box, and AGENCY REF NO EMIVKEMBFL200846 — and Logi-Sys
    // filed the agency reference. Net weight is free text in the description
    // block ("NET WT: 25000.00 KGS"), never a labelled field.
    shipment: {
      blNo: 'EMIVKEMBFL200846',
      vessel: 'WADI DUKA',
      voyageNo: '02621/N',
      packageCount: 1000,
      packageUnit: 'BAG',
      grossWeightKg: 25500,
      netWeightKg: 25000,
      marksAndNos: 'AS PER BL',
      // "FCIU8973026 ... 1 X HIGH CUBE 40 CONTAINER STC" — genuinely one box.
      containers: { count: 1, numbers: ['FCIU8973026'], sizes: ['40'] },
    },
    note: 'B/L date: the checklist files 18-Jun-2026; the document prints 15-Jun-2026 as issued. See docs/boe-mapping/open-questions.md.',
  },

  ex_job3: {
    items: { count: 1, lines: [{ index: 0, ritc: '12074090', aidcSerial: '17', igstSerial: 'I67' }] },
    transportMode: 'Sea',
    invoiceCount: 1,
    // The invoice bills 40,800 USD and states "Payment: N/A" — goods going back
    // to the exporter, with nothing to pay. Logi-Sys filed it as
    // "Terms of Payment FOC / Nature Of Transaction Free of cost".
    termsOfPayment: 'FOC',
    natureOfTransaction: 'Free of cost',
    // Re-import of Indian-origin goods, free of cost. Marks & Nos is an
    // operator-written declaration, so extraction is expected to land on
    // "AS PER BL" and the person to replace it.
    shipment: {
      blNo: '270331190',
      packageCount: 960,
      packageUnit: 'BAG',
      grossWeightKg: 24153.6,
      // "1 X 40' FCL CONTAINER" then "CONTAINER: CAAU7244728".
      containers: { count: 1, numbers: ['CAAU7244728'], sizes: ['40'] },
    },
    note:
      'Two values on this job are not scored because they are not on any document. ' +
      'blDate: the checklist files 13-May-2026 and the waybill\'s "Shipped on Board Date" and ' +
      '"Date Issue of Waybill" boxes are both empty — the mapper warns on SHIPMENT.AWB_BL_Date, ' +
      'which is the correct outcome. Marks & Nos: the checklist reads "RE-IMPORT OF INDIAN ORIGIN ' +
      'GOODS & RE EXPORTED", written by the operator.',
  },

  ex_job5: {
    // ITEMS: 104 lines across twelve invoices; ITA goods under 24/2005.
    items: {
      count: 104,
      lines: [
        { index: 0, ritc: '85322990', aidcSerial: '17', igstSerial: 'II504', basic: { notification: '024/2005', serial: '20' } },
        { index: 1, ritc: '85411000', basic: { notification: '024/2005', serial: '23' } },
      ],
    },
    transportMode: 'Air',
    // Twelve invoices in one PDF, which the checklist prints as "Invoice 1 / 12"
    // and which the pipeline used to collapse to one — eleven declarations
    // discarded, with nothing in this harness able to see it.
    invoiceCount: 12,
    invoiceNumber: 'NI26060135',
    // MAWB prefix 618 -> Singapore Airlines. The packing list mixes cartons and
    // pallets, which is why the operator filed the generic PKG.
    shipment: {
      mawbNo: '61854841905',
      hawbNo: 'OGC2606212',
      blDate: '2026-06-10',
      carrier: 'SINGAPORE AIRLINES LTD.',
      packageCount: 20,
      grossWeightKg: 490,
      marksAndNos: '61854841905\n................\nOGC2606212',
    },
    note:
      'Checklist says 20 PKG; neither the waybill nor the packing list states a package kind. ' +
      'The BE files one invoice of the twelve (11 lines of 104) — see the multi-invoice note in open-questions.md.',
  },

  ex_job6: {
    // ITEMS: Japan CEPA in Basic with P; polypropylene is AIDC S.No. 19, not 17.
    items: {
      count: 1,
      lines: [{ index: 0, ritc: '39021000', aidcSerial: '19', igstSerial: 'II114', fta: { slot: 'BASIC', notification: '069/2011', serial: '295' } }],
    },
    transportMode: 'Sea',
    invoiceCount: 1,
    // The KGM case, the "6 CTRS" vs "(6,258 BAG(S))" case, and the carrier that
    // exists only in a signature block. Net weight is on the attached list.
    shipment: {
      blNo: 'A07GX14312',
      blDate: '2026-07-14',
      carrier: 'INTERASIA LINES',
      vessel: 'INTERASIA TENACITY',
      voyageNo: 'S022',
      packageCount: 6258,
      packageUnit: 'BAG',
      grossWeightKg: 157703,
      netWeightKg: 156450,
      marksAndNos: 'AS PER BL',
      // Six boxes, listed as "IAAU1141498 40SD96 IAAH479523" under the marks
      // block, with "SAY : SIX CONTAINERS ONLY" beside them. The hand-keyed
      // attempt at this job carried one.
      containers: {
        count: 6,
        numbers: [
          'IAAU1141498',
          'IAAU1730986',
          'IAAU1818697',
          'IAAU1868002',
          'IAAU1947945',
          'IAAU1957028',
        ],
        sizes: ['40', '40', '40', '40', '40', '40'],
      },
    },
    note: 'blDate is what the document prints. The Logi-Sys checklist files 30-Jun-2026 and the B/L shows only 14-Jul-2026 — tracked in open-questions.md; do not "fix" this by asserting the checklist value.',
  },

  // The B/L is a scan with no text layer at all, which makes it the job that
  // says whether the container list survives a document the model has to read
  // as an image. Only what the filed checklist states is asserted.
  ex_job4: {
    items: { count: 2, lines: [{ index: 0, ritc: '39046100', aidcSerial: '17', igstSerial: 'II114' }] },
    transportMode: 'Sea',
    // Also a free-of-cost re-import ("REJECTED AND RETURNBLE CARGO"), but the
    // invoice is a scan with no text layer, so nothing about the sale is
    // readable. Deliberately not asserted — see `note`.
    note: 'INV AND PACK.pdf has no text layer; the FOC terms Logi-Sys filed are not readable from it.',
    shipment: {
      containers: { count: 1, numbers: ['MSMU4969528'], sizes: ['40'] },
    },
  },

  liv_job1: {
    transportMode: 'Sea',
    // The container trap: the totals box reads "0004 CNTR" beside cargo of
    // 4000 BAG(S), and the carrier is in an explicit Carrier field the
    // vendor's own export left unused.
    shipment: {
      blNo: 'TAOCB25013453',
      blDate: '2025-07-12',
      carrier: 'RCL FEEDER PTE LTD',
      vessel: 'WAN HAI 515',
      voyageNo: 'W101',
      packageCount: 4000,
      packageUnit: 'BAG',
      grossWeightKg: 100400,
      marksAndNos: 'AS PER BL',
      // Four boxes down the "Container No./Seal No." column, with "0004 CNTR"
      // in the totals box. Logi-Sys' own export of this job carries all four.
      containers: {
        count: 4,
        numbers: ['CAIU3686895', 'CAIU3772397', 'SEGU1294439', 'TGBU3711543'],
        sizes: ['20', '20', '20', '20'],
      },
    },
  },
};

function check(label: string, actual: unknown, expected: unknown): boolean {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  return ok;
}

async function evalJob(jobDir: string): Promise<{ passed: number; failed: number }> {
  const name = path.basename(jobDir);
  const expected = EXPECTATIONS[name];
  const fileNames = (await readdir(jobDir)).filter(
    (f) => f.toLowerCase().endsWith('.pdf') && !f.toLowerCase().includes('checklist'),
  );
  console.log(`\n━━━ ${name}: ${fileNames.join(', ')}`);

  const files = await Promise.all(
    fileNames.map(async (fileName) => ({ fileName, pdf: await readFile(path.join(jobDir, fileName)) })),
  );
  const t0 = Date.now();
  const { draft, docs } = await runPipeline(files, {
    today: '2026-08-05',
    onProgress: (e) => console.log(`  … ${e.stage} ${e.fileName ?? ''} ${e.detail ?? ''}`),
  });
  console.log(`  (pipeline ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  // Extraction is the slow, paid half of a run and a merge change does not
  // touch it. Saving what was extracted lets a merge-only change be compared
  // against the very same documents, rather than against a second extraction
  // that differs for its own reasons.
  if (process.env.EVAL_DUMP_DIR) {
    await mkdir(process.env.EVAL_DUMP_DIR, { recursive: true });
    await writeFile(path.join(process.env.EVAL_DUMP_DIR, `${name}.docs.json`), JSON.stringify(docs));
  }

  for (const d of docs) console.log(`  📄 ${d.fileName} → ${d.docType} [${d.model}]`);

  let passed = 0;
  let failed = 0;
  const tally = (ok: boolean) => (ok ? passed++ : failed++);

  if (expected) {
    tally(check('transport mode', draft.transportMode, expected.transportMode));
    // The importer's GSTIN is filled by `applyPartyResolution()`, which needs a
    // company and a database and so cannot run here — see the comment above
    // `importer` in merge.ts. Reported, never tallied, so a structural gap in
    // the harness does not sit permanently red and teach people to ignore it.
    if (expected.importerGstin)
      check('importer GSTIN (needs the DB — not scored)', draft.importer.gstin, expected.importerGstin);
    const first = draft.invoices[0];
    if (expected.invoiceNumber)
      tally(check('invoice number', first?.invoiceNumber, expected.invoiceNumber));
    if (expected.invoiceCount != null)
      tally(check('invoice count', draft.invoices.length, expected.invoiceCount));
    if (expected.toi) tally(check('terms of invoice', first?.termsOfInvoice, expected.toi));
    if (expected.miscCharges != null)
      tally(check('misc charges', first?.miscCharges?.amount, expected.miscCharges));
    if (expected.termsOfPayment)
      tally(check('terms of payment', termsOfPayment(first?.termsOfPayment).code, expected.termsOfPayment));
    if (expected.natureOfTransaction)
      tally(check('nature of transaction', first?.natureOfTransaction, expected.natureOfTransaction));
    if (expected.ritc) tally(check('item RITC', draft.items[0]?.ritc, expected.ritc));

    // SHIPMENT. Each line is a column of the sheet that has gone missing at
    // least once against a real document.
    const sh = expected.shipment;
    if (sh) {
      const s = draft.shipment;
      if (sh.blNo) tally(check('SHIPMENT B/L no', s.blNo, sh.blNo));
      if (sh.mawbNo) tally(check('SHIPMENT MAWB no', s.mawbNo, sh.mawbNo));
      if (sh.hawbNo) tally(check('SHIPMENT HAWB no', s.hawbNo, sh.hawbNo));
      if (sh.blDate) tally(check('SHIPMENT transport doc date', s.blDate ?? s.mawbDate, sh.blDate));
      if (sh.carrier) {
        // Compared by containment, not equality. A B/L's signature block gives
        // the carrier's full legal name — "INTERASIA LINES SINGAPORE PTE. LTD."
        // — where Logi-Sys' accepted workbook carries the trading name
        // "INTERASIA LINES". Both name the same company, and normalising one to
        // the other would need a carrier-name master we deliberately do not
        // have (see docs/boe-mapping/masters.md). What matters is that the
        // column is filled with the carrier rather than the agent.
        const got = (s.shippingLineOrCarrier ?? '').toUpperCase();
        const want = sh.carrier.toUpperCase();
        tally(
          check(
            'SHIPMENT carrier (contains)',
            got.includes(want) || want.includes(got) ? sh.carrier : s.shippingLineOrCarrier,
            sh.carrier,
          ),
        );
      }
      if (sh.vessel) tally(check('SHIPMENT vessel', s.vesselOrFlight, sh.vessel));
      if (sh.voyageNo) tally(check('SHIPMENT voyage/flight no', s.voyageNo, sh.voyageNo));
      if (sh.packageCount != null)
        tally(check('SHIPMENT package count', s.packageCount, sh.packageCount));
      if (sh.packageUnit)
        tally(check('SHIPMENT package kind', normalizePackageUnit(s.packageUnit), sh.packageUnit));
      if (sh.grossWeightKg != null)
        tally(check('SHIPMENT gross weight', s.grossWeightKg, sh.grossWeightKg));
      if (sh.netWeightKg != null)
        tally(check('SHIPMENT net weight', s.netWeightKg, sh.netWeightKg));
      if (sh.marksAndNos) tally(check('SHIPMENT marks & nos', s.marksAndNos, sh.marksAndNos));

      // CONTAINERS. Scored as a set, because B/Ls list boxes in whatever order
      // suits their layout and the sheet numbers them positionally anyway.
      if (sh.containers) {
        const got = s.containers.map((c) => normaliseContainerNumber(c.number)).sort();
        tally(check('CONTAINERS count', s.containers.length, sh.containers.count));
        if (sh.containers.numbers) {
          const want = sh.containers.numbers.map(normaliseContainerNumber).sort();
          tally(check('CONTAINERS numbers', got.join(','), want.join(',')));
        }
        if (sh.containers.sizes) {
          const sizes = s.containers
            .map((c) => parseContainerSizeType(c.sizeType).size ?? '?')
            .sort();
          tally(check('CONTAINERS sizes', sizes.join(','), [...sh.containers.sizes].sort().join(',')));
        }
        // Not scored: seal numbers are missing from Logi-Sys' own export of
        // liv_job1, so the corpus cannot say what "right" is. Printed so a
        // regression in reading them is at least visible.
        console.log(
          `  ℹ️  seals: ${s.containers.map((c) => `${c.number}=${c.sealNo ?? '—'}`).join(' ')}`,
        );
        console.log(`  ℹ️  B/L states: ${s.containerCountStated ?? 'no total printed'}`);
      }
    }
    if (expected.dutyComputed)
      tally(check('duty computed (payable > 0)', (draft.duty?.dutyPayable ?? 0) > 0, true));
    if (expected.totalAssessableValue != null)
      tally(check('total assessable value', draft.duty?.totalAssessableValue, expected.totalAssessableValue));
    if (expected.dutyPayable != null) {
      // Not scored when the job needs the importer's marine open-policy rate.
      // That rate hangs off the organization record — see the comment at the
      // insurance flag in merge.ts — so on an EXW/FOB job the eval's assessable
      // value is short by exactly the insurance and the duty differs. The same
      // structural gap as the GSTIN above, not a duty-engine defect.
      // The flag is per invoice — `invoices.0.insurance` — so any one of them
      // needing the rate is enough to make the total not comparable.
      const needsOrg = draft.flags.some((f) => f.path?.endsWith('.insurance'));
      const label = needsOrg ? 'duty payable (needs the org master — not scored)' : 'duty payable';
      const ok = check(label, draft.duty?.dutyPayable, expected.dutyPayable);
      if (!needsOrg) tally(ok);
    }
    if (expected.ftaScheme) tally(check('FTA scheme', draft.ftaClaim?.scheme, expected.ftaScheme));
    if (expected.items) {
      const it = expected.items;
      if (it.count != null) tally(check('ITEMS count', draft.items.length, it.count));
      for (const line of it.lines ?? []) {
        const got = draft.items[line.index];
        const at = `ITEMS[${line.index}]`;
        if (line.ritc) tally(check(`${at} CTH`, got?.ritc, line.ritc));
        if (line.aidcSerial) tally(check(`${at} AIDC serial`, got?.aidcLevy?.serial ?? got?.notificationSerials?.aidc, line.aidcSerial));
        if (line.igstSerial) tally(check(`${at} IGST serial`, got?.notificationSerials?.igst, line.igstSerial));
        if (line.basic) {
          tally(check(`${at} Basic_Notn`, got?.bcdNotification ?? (got?.fta?.slot === 'BASIC' ? got.fta.notification : undefined), line.basic.notification));
          tally(check(`${at} Basic_NotnSrNo`, got?.notificationSerials?.basic ?? got?.fta?.serial, line.basic.serial));
        }
        if (line.fta) {
          tally(check(`${at} FTA slot`, got?.fta?.slot, line.fta.slot));
          tally(check(`${at} FTA notification`, got?.fta?.notification, line.fta.notification));
          tally(check(`${at} FTA serial`, got?.fta?.serial, line.fta.serial));
        }
      }
    }
    if (expected.note) console.log(`  ℹ️  ${expected.note}`);
  }

  console.log(`  items: ${draft.items.map((i) => `${i.ritc} ${i.description.slice(0, 40)}… qty ${i.quantity} ${i.unit}`).join(' | ')}`);
  console.log(`  duty: AV ${draft.duty?.totalAssessableValue} payable ${draft.duty?.dutyPayable} (${draft.duty?.dutyPayableInWords ?? 'n/a'})`);
  console.log(`  flags:`);
  for (const f of draft.flags) console.log(`    [${f.severity}] ${f.path ?? ''} ${f.message}`);

  return { passed, failed };
}

const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ERP_ROOT, 'ex_job1'), path.join(ERP_ROOT, 'ex_job2')];

let totalPassed = 0;
let totalFailed = 0;
for (const dir of dirs) {
  const { passed, failed } = await evalJob(dir);
  totalPassed += passed;
  totalFailed += failed;
}
console.log(`\n═══ eval: ${totalPassed} passed, ${totalFailed} failed`);
process.exit(totalFailed ? 1 : 0);
