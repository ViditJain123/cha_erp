/**
 * Run the whole corpus of example jobs through the live system and keep the
 * Logi-Sys workbook each one produces.
 *
 *   set -a; . .env.local; set +a
 *   cd apps/web
 *   ./node_modules/.bin/tsx --conditions react-server scripts/corpus-export.mts
 *
 * This is the dry run the ERP is judged by: a person files the same jobs in
 * Logi-Sys by hand, and the two workbooks are compared column by column. So it
 * has to be the *live* path — `processUpload`, `buildDraftFromDocuments`,
 * `buildLogisysWorkbook` — and not a harness that reimplements any of it. The
 * only thing this file adds is the glue the HTTP routes add: the job_drafts
 * version, the job_exports row, and a copy of the workbook on disk.
 *
 * **The checklist is withheld.** Every folder in the corpus also holds the
 * answer — the Logi-Sys checklist PDF, the processed Bill of Entry, or the
 * vendor's own JobData export. `isAnswerKey()` below keeps all three out of the
 * job, so nothing downstream can read one. Withheld files are named in the
 * report rather than silently dropped, because "the model never saw it" is the
 * claim the whole comparison rests on.
 *
 * The mail thread is *not* an answer key and is seeded: `email.txt` is what the
 * broker actually had in front of them, and the header — custom house, BE type,
 * end use, whether to claim an FTA — is read off it by `readMailInstructions`
 * exactly as it is in production.
 *
 * Flags:
 *   --only ex_job10,ex_job12   just these folders
 *   --skip ex_job7             leave these out
 *   --force                    redo folders already finished in state.json
 *   --fresh                    with --force, also drop the decisions a previous
 *                              run recorded on the job, so they are made again
 *                              against the draft this run produced
 *   --dry-run                  list what would run, touch nothing
 *   --concurrency 3            folders in flight at once (default 2)
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveIndianStation } from '@checklist/core';
import { processUpload } from '@checklist/ingest';
import { buildLogisysWorkbook } from '@checklist/exporter';
import type { ChecklistDraft } from '@checklist/extraction';
import { applyJobResolution, buildDraftFromDocuments } from '@/lib/draft-pipeline';
import { serviceClient } from '@/lib/supabase/admin';

const ERP_ROOT = path.resolve(import.meta.dirname, '../../..', '..');
const OUT_ROOT = path.join(ERP_ROOT, 'corpus-exports');
const STATE_FILE = path.join(OUT_ROOT, 'state.json');
/** Documents unpacked out of a `.eml`. Derived, so the corpus folders stay as they were. */
const UNPACKED_ROOT = path.join(OUT_ROOT, '_unpacked');

/** Kuber — the company that holds the 5,091-row organization repository. */
const COMPANY_ID = process.env.CORPUS_COMPANY_ID ?? '39ec24f0-2254-4e08-abbd-4fe19c09f878';
/** pre-alert.import@kuberrgroup.com, the company admin these jobs belong to. */
const UPLOADED_BY = process.env.CORPUS_PROFILE_ID ?? 'd8017e21-3216-4e38-824b-fe915fa971be';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function option(name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && argv[at + 1] && !argv[at + 1]!.startsWith('--')) return argv[at + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}
const ONLY = option('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const SKIP = new Set((option('skip')?.split(',') ?? []).map((s) => s.trim()).filter(Boolean));
const FORCE = flag('force');
const FRESH = flag('fresh');
const DRY_RUN = flag('dry-run');
const CONCURRENCY = Number(option('concurrency') ?? 2);

// ------------------------------------------------------------- answer keys

/**
 * Files that are the answer rather than the input.
 *
 * Three kinds, and each one would settle the whole Bill of Entry if it reached
 * extraction:
 *   - `Import CheckList-*.pdf` — what Logi-Sys printed for the operator to
 *     approve. Every field we are trying to predict is on it.
 *   - `Processed BE_*.pdf` — the filed Bill of Entry as ICES returned it.
 *   - `JobData_*.xlsx` / `logisys-*.xlsx` — the vendor's own export of the filed
 *     job, and ours from an earlier run.
 *
 * `ImportXLSXTemplate.xlsx` is the empty vendor template someone mailed around;
 * it is not a document either.
 *
 * An into-bond Bill of Entry is deliberately *not* here. An ex-bond filing is
 * made against a prior into-bond BE, and the broker has that one in hand before
 * they start — it is an input, and half the INBOND_EXBOND sheet comes off it.
 */
function isAnswerKey(fileName: string): boolean {
  const f = fileName.toLowerCase();
  if (/check\s*_?list/.test(f)) return true;
  if (/^processed[\s_]*be/.test(f)) return true;
  if (/^jobdata[\s_-]/.test(f)) return true;
  if (/^logisys-/.test(f)) return true;
  if (f === 'importxlsxtemplate.xlsx') return true;
  // ex_job18 carries "14159 E BOE.pdf" — an electronic Bill of Entry for this
  // same consignment. Same leak as a processed BE, different spelling.
  if (/\be[\s_-]?bo?e\b/.test(f)) return true;
  return false;
}

/**
 * What the pipeline can read: a PDF, or a photograph of a document.
 *
 * Two folders carry their bill of lading only as a phone scan — `ex_job8` and
 * `ex_job9`, both named in Chinese — and skipping those left the job with no
 * transport document, no containers and no place of delivery. A spreadsheet or
 * a `.doc` is listed in the report instead, because nothing in the system reads
 * one yet.
 */
const READABLE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function mediaType(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? undefined : READABLE_TYPES[fileName.slice(dot).toLowerCase()];
}

function isReadable(fileName: string): boolean {
  return mediaType(fileName) !== undefined;
}

/**
 * Unpack the `.eml` files a folder was saved with.
 *
 * Two folders were kept as whole Outlook messages rather than as loose
 * attachments, and `ex_job20` keeps its commercial invoice only in there — so
 * skipping them would fail that job over the corpus' filing, not over anything
 * the system does. The documents land in a derived directory and the message
 * joins the thread; the original folder is not touched.
 */
function unpackEml(folder: string, dir: string, entries: string[]): { files: { dir: string; name: string }[]; messages: ThreadMessage[] } {
  const files: { dir: string; name: string }[] = [];
  const messages: ThreadMessage[] = [];
  const outDir = path.join(UNPACKED_ROOT, folder);
  for (const entry of entries.filter((e) => e.toLowerCase().endsWith('.eml'))) {
    const raw = execFileSync('python3', [
      path.join(import.meta.dirname, 'corpus-eml.py'),
      path.join(dir, entry),
      outDir,
    ]);
    const parsed = JSON.parse(raw.toString()) as {
      subject: string | null;
      from: string | null;
      date: string | null;
      body: string;
      attachments: string[];
    };
    for (const name of parsed.attachments) {
      if (isAnswerKey(name) || !isReadable(name)) continue;
      files.push({ dir: outDir, name });
    }
    if (parsed.body) {
      messages.push({
        subject: parsed.subject,
        from: parsed.from,
        receivedAt: parsed.date ? new Date(parsed.date).toISOString() : null,
        attachments: parsed.attachments,
        body: parsed.body,
      });
    }
  }
  return { files, messages };
}

// -------------------------------------------------------------- mail thread

interface ThreadMessage {
  subject: string | null;
  from: string | null;
  receivedAt: string | null;
  attachments: string[];
  body: string;
}

/**
 * Split an exported `email.txt` back into the messages it was made of.
 *
 * The export is one header block per message — Subject/From/To/Received/
 * Attachments — then a rule of dashes, then the body, with messages separated
 * by a rule of equals signs. Parsed rather than stored whole because
 * `readMailInstructions` re-reads the thread whenever it has grown, and counts
 * messages to decide that.
 */
function parseThread(text: string): ThreadMessage[] {
  return text
    .split(/^={20,}$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [head, ...rest] = block.split(/^-{20,}$/m);
      const header = head ?? '';
      const body = rest.join('\n').trim();
      const field = (name: string) => {
        const m = header.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, 'mi'));
        return m?.[1]?.trim() || null;
      };
      const attachments = (field('Attachments \\(\\d+\\)') ?? field('Attachments'))
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
      return {
        subject: field('Subject'),
        from: field('From'),
        receivedAt: parseReceived(field('Received')),
        attachments,
        body: body || header.trim(),
      };
    })
    .filter((m) => m.body.length > 0);
}

/** "Tue 8/11/2026 6:09 PM" — Outlook's own format, in the CHA's local time. */
function parseReceived(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const [, mm, dd, yyyy, hh, min, ampm] = m;
  let hour = Number(hh);
  if (ampm?.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (ampm?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  // IST: the mailbox is the CHA's, and the hour only has to order the thread.
  const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${min}:00+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The connection the seeded messages hang off.
 *
 * `mail_messages.connection_id` is not nullable — a message came from a
 * mailbox or it did not exist. This corpus has no live mailbox for the Kuber
 * company, so one is created `disabled`: `claim_mail_connection` only ever
 * hands the worker an `active` row, so this can never be polled.
 */
async function corpusConnectionId(): Promise<string> {
  const db = serviceClient();
  const address = 'corpus@example.invalid';
  const { data: existing } = await db
    .from('mail_connections')
    .select('id')
    .eq('company_id', COMPANY_ID)
    .eq('email_address', address)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await db
    .from('mail_connections')
    .insert({
      company_id: COMPANY_ID,
      profile_id: UPLOADED_BY,
      provider: 'microsoft',
      provider_account_id: 'corpus-dry-run',
      email_address: address,
      display_name: 'Corpus dry run (not a real mailbox)',
      status: 'disabled',
      next_poll_at: '2099-01-01T00:00:00Z',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not create the corpus mail connection: ${error?.message}`);
  return data.id;
}

async function seedThread(folder: string, jobId: string, messages: ThreadMessage[]) {
  const db = serviceClient();
  const connectionId = await corpusConnectionId();
  for (const [index, message] of messages.entries()) {
    await db.from('mail_messages').upsert(
      {
        company_id: COMPANY_ID,
        connection_id: connectionId,
        job_id: jobId,
        provider_message_id: `corpus:${folder}:${index}`,
        conversation_id: `corpus:${folder}`,
        subject: message.subject,
        from_address: fromAddress(message.from),
        from_name: message.from,
        received_at: message.receivedAt,
        has_attachments: message.attachments.length > 0,
        body_text: message.body,
        body_preview: message.body.slice(0, 255),
        outcome: 'attached',
        processed_at: new Date().toISOString(),
      },
      { onConflict: 'connection_id,provider_message_id' },
    );
  }
}

function fromAddress(from: string | null): string | null {
  return from?.match(/<([^>]+)>/)?.[1] ?? from;
}

// ---------------------------------------------------------- the operator

/**
 * The decisions a broker would make at their desk, made here instead.
 *
 * The exporter refuses on anything it would otherwise have to invent, and three
 * of those refusals are not the model's failure at all — they are questions
 * only a person can answer, and in production a person does:
 *
 *   - **which custom house.** The mail says it, or the importer has a standing
 *     default. Neither exists for a corpus folder, so the bill of lading's own
 *     place of delivery is used, through the same station master the app uses.
 *     It is right whenever the consignment clears where it lands, which is most
 *     of them, and wrong on a job that moves in bond to another station —
 *     recorded per job so the comparison can see which.
 *   - **a classification this importer has not filed before.** The blocker asks
 *     for a person to look at the proposed CTH and stand behind it. Confirmed
 *     here on the job *only* — deliberately not written into `product_master`,
 *     because remembering a guess for every future job of that importer is a
 *     worse error than this one run being off.
 *   - **which AD code**, when the importer banks through several.
 *
 * Everything else that blocks stays blocked: a line that does not reconcile, a
 * missing tariff code, an ex-bond job with no into-bond BE. Those are the
 * findings the dry run is for, and answering them here would hide them.
 */
interface OperatorDecision {
  path: string;
  choice: string;
  because: string;
}

async function decide(
  jobId: string,
  draft: ChecklistDraft,
  blockers: string[],
): Promise<OperatorDecision[]> {
  const db = serviceClient();
  const decisions: OperatorDecision[] = [];
  const header: Record<string, string> = {};

  if (blockers.some((b) => b.startsWith('GENERAL.CustomsHouseCode'))) {
    // The same precedence and the same tie-break the merge uses: a place of
    // final delivery can be either kind of station, a port of discharge is a
    // sea one and an airport of destination an air one. Without the hint
    // "MUMBAI (EX BOMBAY)" off an air waybill resolved to Mumbai *Sea*, which
    // would have filed an air consignment at the docks.
    const { placeOfDelivery, portOfDischarge, airportOfDestination } = draft.shipment;
    // A place of delivery that repeats the port of discharge is the port, so it
    // is the sea station of that name rather than the ICD.
    const bare = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sameBox =
      placeOfDelivery && portOfDischarge
        ? bare(placeOfDelivery) === bare(portOfDischarge) ||
          bare(placeOfDelivery).startsWith(bare(portOfDischarge)) ||
          bare(portOfDischarge).startsWith(bare(placeOfDelivery))
        : false;
    const [place, kind, source] = placeOfDelivery
      ? ([placeOfDelivery, sameBox ? 'sea' : undefined, 'the bill of lading delivers to'] as const)
      : portOfDischarge
        ? ([portOfDischarge, 'sea', 'the bill of lading discharges at'] as const)
        : ([airportOfDestination, 'air', 'the air waybill is consigned to'] as const);
    const station = place ? resolveIndianStation(place, kind) : undefined;
    if (station) {
      header.customs_house_code = station.code;
      decisions.push({
        path: 'GENERAL.CustomsHouseCode',
        choice: `${station.code} — ${station.name}`,
        because: `${source} "${place}"`,
      });
    }
  }

  if (blockers.some((b) => b.startsWith('GENERAL.AD_Code'))) {
    const choice = draft.boe?.adCodeChoices?.[0];
    if (choice) {
      header.ad_code = choice.adCode;
      decisions.push({
        path: 'GENERAL.AD_Code',
        choice: choice.adCode,
        because: `the importer banks through ${draft.boe?.adCodeChoices?.length} AD codes and this is the first`,
      });
    }
  }

  if (Object.keys(header).length) {
    await db.from('job_boe_header').upsert(
      { job_id: jobId, company_id: COMPANY_ID, ...header, updated_by: UPLOADED_BY },
      { onConflict: 'job_id' },
    );
  }

  // A re-import line waits for a person to say which entry of 45/2017 is being
  // claimed. The resolver offers them best-supported first and deliberately
  // picks none, because which one this CHA claims when several fit is an open
  // question (docs/boe-mapping/open-questions.md). So the corpus takes the
  // first and says so — the point of running it against Logi-Sys is to find out
  // what they actually file, and a recorded wrong answer settles that where a
  // blocked job settles nothing.
  const reImports = blockers
    .filter((b) => /^RE-IMPORT\[\d+\/\d+\]\.Notn_SrNo/.test(b))
    .map((b) => b.match(/^RE-IMPORT\[(\d+)\/(\d+)\]/)?.slice(1, 3).map(Number));
  for (const pair of reImports) {
    const [invoiceSrNo, itemSrNo] = pair ?? [];
    const item = draft.items.find((i) => i.invoiceSrNo === invoiceSrNo && i.slNo === itemSrNo);
    const offered = item?.reImport?.candidates ?? [];
    // Best-supported first, but an entry whose duty is an amount somebody has
    // to hand us — the integrated tax not paid at export, the incentive repaid
    // — cannot be filed from the documents on the job at all. So the first
    // entry that can be is taken, and the rest are recorded beside it. ex_job3
    // fits four entries and the most-supported of them, 045/2017 1D, asks for a
    // figure that is on the export invoice and nowhere in this folder.
    const filable = offered.find((c) => !c.needsIncentiveRepayment && !c.needsExportFreightInsurance);
    const candidate = filable ?? offered[0];
    if (!item || !candidate) continue;
    await db.from('job_items').upsert(
      {
        company_id: COMPANY_ID,
        job_id: jobId,
        invoice_sr_no: item.invoiceSrNo,
        item_sr_no: item.slNo,
        fields: {},
        re_import: {
          notification: {
            value: { notification: candidate.notification, serial: candidate.serial },
            source: 'operator',
            because: 'Corpus run: the best-supported candidate, unverified.',
          },
        } as never,
        re_import_confirmed: true,
        updated_by: UPLOADED_BY,
      },
      { onConflict: 'job_id,invoice_sr_no,item_sr_no' },
    );
    decisions.push({
      path: `RE-IMPORT[${invoiceSrNo}/${itemSrNo}].Notn_SrNo`,
      choice: `${candidate.notification} ${candidate.serial}`,
      because:
        `${candidate.because}` +
        `${filable && filable !== offered[0] ? ' Taken over the better-supported entries because theirs is an amount no document on the job states.' : ''}` +
        ` Others that fit: ${offered
          .filter((c) => c !== candidate)
          .map((c) => `${c.notification} ${c.serial}`)
          .join(', ') || 'none'}`,
    });
  }

  // An anti-dumping or safeguard row that fits the CTH but names a producer and
  // exporter the documents do not settle. One candidate is the ordinary case
  // and taking it is what an operator would do; several is a real choice about
  // who made the goods, and the corpus leaves that blocked rather than guess.
  const remedies = blockers
    .filter((b) => /^ITEMS\[\d+\]\.ADD_Notn: .* trade-remedy row/.test(b))
    .map((b) => Number(b.match(/^ITEMS\[(\d+)\]/)?.[1]));
  for (const index of remedies) {
    const item = draft.items[index!];
    const candidates = item?.tradeRemedyCandidates ?? [];
    if (!item || candidates.length !== 1) continue;
    const picked = candidates[0]!;
    const line = picked.line ?? {
      kind: picked.kind,
      notification: picked.notification,
      ...(picked.cthSerial && { cthSerial: picked.cthSerial }),
      ...(picked.supplierSerial && { supplierSerial: picked.supplierSerial }),
    };
    await mergeItemFields(jobId, item.invoiceSrNo, item.slNo, {
      tradeRemedies: [...(item.tradeRemedies ?? []).filter((l) => l.kind !== picked.kind), line],
    });
    decisions.push({
      path: `ITEMS[${index}].ADD_Notn`,
      choice: `${picked.kind} ${picked.notification} row ${picked.cthSerial ?? '?'}`,
      because: `the only trade-remedy row that fits the CTH (${picked.producer} / ${picked.exporter})`,
    });
  }

  // A classification blocker names its line as `ITEMS[i].CTH`.
  const unconfirmed = blockers
    .filter((b) => /^ITEMS\[\d+\]\.CTH: .* is new for this importer/.test(b))
    .map((b) => Number(b.match(/^ITEMS\[(\d+)\]/)?.[1]));
  for (const index of unconfirmed) {
    const item = draft.items[index!];
    if (!item?.ritc) continue;
    await db.from('job_items').upsert(
      {
        company_id: COMPANY_ID,
        job_id: jobId,
        invoice_sr_no: item.invoiceSrNo,
        item_sr_no: item.slNo,
        fields: {},
        classification_confirmed: true,
        updated_by: UPLOADED_BY,
      },
      { onConflict: 'job_id,invoice_sr_no,item_sr_no' },
    );
    decisions.push({
      path: `ITEMS[${index}].CTH`,
      choice: item.ritc,
      because: `confirmed the proposed classification for "${item.description.slice(0, 40)}"`,
    });
  }

  return decisions;
}

/** Merge operator fields into a job_items row, keeping what is already on it. */
async function mergeItemFields(
  jobId: string,
  invoiceSrNo: number,
  itemSrNo: number,
  fields: Record<string, unknown>,
): Promise<void> {
  const db = serviceClient();
  const { data: existing } = await db
    .from('job_items')
    .select('fields')
    .eq('company_id', COMPANY_ID)
    .eq('job_id', jobId)
    .eq('invoice_sr_no', invoiceSrNo)
    .eq('item_sr_no', itemSrNo)
    .maybeSingle();
  await db.from('job_items').upsert(
    {
      company_id: COMPANY_ID,
      job_id: jobId,
      invoice_sr_no: invoiceSrNo,
      item_sr_no: itemSrNo,
      fields: { ...((existing?.fields as Record<string, unknown> | null) ?? {}), ...fields } as never,
      updated_by: UPLOADED_BY,
    },
    { onConflict: 'job_id,invoice_sr_no,item_sr_no' },
  );
}

/** The blocker lines out of the exporter's refusal message. */
function blockersOf(error: Error): string[] {
  // `SHEET[index].Column: message`, where the index is `0` on ITEMS and `1/1`
  // on the sheets keyed by invoice and item, and the sheet name may be
  // hyphenated (`RE-IMPORT`). Matching it too narrowly is silent: the blocker
  // is simply never answered and the job stays refused.
  //
  // A message can run over several lines, because it quotes the goods
  // description and a description off an invoice contains newlines. So lines
  // are joined back onto the blocker they belong to rather than read one by
  // one — read one by one, "…is new for this importer" ends up on a line of its
  // own and the classification is never confirmed.
  const head = /^[A-Z][A-Z0-9_-]*(\[[^\]]*\])?(\.[A-Za-z0-9_]+)*:/;
  const out: string[] = [];
  for (const raw of error.message.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('These would produce')) break;
    if (head.test(line)) out.push(line);
    else if (out.length) out[out.length - 1] += ` ${line}`;
  }
  return out;
}

// ------------------------------------------------------------------- state

interface FolderState {
  folder: string;
  jobId?: string;
  jobCreated?: boolean;
  draftVersion?: number;
  exportFile?: string;
  warnings?: string[];
  /** ICES rejections this workbook would draw, by published error code. */
  icesFindings?: number;
  flags?: number;
  /** What the corpus operator answered for this job — see `decide()`. */
  decisions?: OperatorDecision[];
  fed?: string[];
  withheld?: string[];
  unreadable?: string[];
  status: 'ok' | 'blocked' | 'failed' | 'pending';
  error?: string;
  finishedAt?: string;
}

async function loadState(): Promise<Record<string, FolderState>> {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}

let state: Record<string, FolderState> = {};
async function saveState() {
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// -------------------------------------------------------------------- run

async function runFolder(folder: string): Promise<FolderState> {
  const db = serviceClient();
  const dir = path.join(ERP_ROOT, folder);
  const entries = (await readdir(dir)).filter((f) => f !== '.DS_Store' && !f.startsWith('~$'));

  const withheld = entries.filter(isAnswerKey);
  const candidates = entries.filter((f) => !isAnswerKey(f));
  const unpacked = unpackEml(folder, dir, candidates);
  const inputs = [
    ...candidates.filter(isReadable).map((name) => ({ dir, name })),
    ...unpacked.files,
  ];
  const fed = inputs.map((f) => f.name);
  const unreadable = candidates.filter(
    (f) => !isReadable(f) && f !== 'email.txt' && !f.toLowerCase().endsWith('.eml'),
  );

  const log = (message: string) => console.log(`[${folder}] ${message}`);
  log(`${fed.length} document(s) in, ${withheld.length} answer key(s) withheld`);
  if (fed.length === 0) {
    return { folder, status: 'failed', error: 'No readable documents once the answer keys are out.', withheld, unreadable };
  }
  if (DRY_RUN) {
    log(`  in:       ${fed.join(', ')}`);
    if (withheld.length) log(`  withheld: ${withheld.join(', ')}`);
    if (unreadable.length) log(`  not read: ${unreadable.join(', ')}`);
    return { folder, status: 'pending', fed, withheld, unreadable };
  }

  // 1. Ingest — the same triage, matching and storage the drop zone runs.
  //
  // Run on every pass, not only the first: a folder gains documents between
  // runs when the system learns to read a kind of file it could not before —
  // the `.jpg` bills of lading were skipped for exactly as long as the pipeline
  // sent every file as a PDF. Files already stored are recognised by digest and
  // not stored twice, so this is a no-op on a folder that has not changed.
  const previous = state[folder];
  let jobId = previous?.jobId;
  let jobCreated = previous?.jobCreated ?? false;

  const held = new Set<string>();
  if (jobId) {
    const { data: stored } = await db
      .from('job_documents')
      .select('sha256')
      .eq('job_id', jobId)
      .eq('company_id', COMPANY_ID);
    for (const row of stored ?? []) held.add(row.sha256);
  }

  const uploads = await Promise.all(
    inputs.map(async (input) => {
      const data = await readFile(path.join(input.dir, input.name));
      return {
        fileName: input.name,
        contentType: mediaType(input.name) ?? 'application/pdf',
        data,
        sha256: createHash('sha256').update(data).digest('hex'),
      };
    }),
  );
  const fresh = uploads.filter((f) => !held.has(f.sha256));

  if (fresh.length) {
    const upload = await processUpload(db, {
      companyId: COMPANY_ID,
      uploadedBy: UPLOADED_BY,
      files: fresh.map(({ fileName, contentType, data }) => ({ fileName, contentType, data })),
    });
    if (upload.outcome === 'ambiguous' || !upload.jobId) {
      // Two folders in the corpus really are one filing (`ex_job13` and
      // `ex_job26`), so an ambiguous match on a second pass is the matcher
      // being right. Keep the job this folder already has rather than failing.
      if (!jobId) {
        return {
          folder,
          status: 'failed',
          error: `Ingest could not place these documents: ${upload.outcome}${upload.candidateJobIds ? ` (candidates ${upload.candidateJobIds.join(', ')})` : ''}`,
          fed,
          withheld,
          unreadable,
        };
      }
      log(`⚠️  ${fresh.length} new document(s) matched ambiguously and were not attached`);
    } else {
      jobCreated = jobCreated || upload.outcome === 'created_job';
      jobId = upload.jobId;
      log(`${upload.outcome} → job ${jobId} (${upload.documentsAdded} stored, ${upload.documentsDuplicate} already held)`);
      if (upload.outcome === 'created_job') {
        // Name the job after the folder it came from, so a corpus run is
        // identifiable — and deletable — beside the company's real jobs.
        await db.from('jobs').update({ reference: `CORPUS/${folder}` }).eq('id', jobId).eq('company_id', COMPANY_ID);
      }
    }
  } else {
    log(`reusing job ${jobId}`);
  }
  if (!jobId) {
    return { folder, status: 'failed', error: 'No job for this folder.', fed, withheld, unreadable };
  }

  // 2. The mail thread, where there is one.
  const threadPath = path.join(dir, 'email.txt');
  const thread = [
    ...(existsSync(threadPath) ? parseThread(await readFile(threadPath, 'utf8')) : []),
    ...unpacked.messages,
  ];
  if (thread.length) {
    await seedThread(folder, jobId, thread);
    log(`thread: ${thread.length} message(s)`);
  }

  // A re-run keeps what a person decided, which is what the app does when
  // documents are read again — a corrected CTH survives a re-read. For a clean
  // measurement that is the wrong behaviour: a classification confirmed against
  // the *previous* draft would silently confirm whatever this run proposes
  // instead. `--fresh` drops them so every decision is made again, and visibly.
  if (FRESH) {
    await db.from('job_items').delete().eq('job_id', jobId).eq('company_id', COMPANY_ID);
    await db.from('job_boe_header').delete().eq('job_id', jobId).eq('company_id', COMPANY_ID);
    log('operator decisions cleared');
  }

  // 3. Read the documents into a draft — exactly what POST /api/jobs/[id]/draft
  //    does, down to reading them back out of storage rather than off disk.
  const { data: documents } = await db
    .from('job_documents')
    .select('file_name, storage_bucket, storage_path, mime_type')
    .eq('job_id', jobId)
    .eq('company_id', COMPANY_ID);
  if (!documents?.length) {
    return { folder, status: 'failed', error: 'The job has no stored documents.', jobId, fed, withheld, unreadable };
  }
  // Belt and braces: an answer key can only be here if a previous run put it
  // here, and it must not be read even then.
  const readable = documents.filter((d) => !isAnswerKey(d.file_name));
  const leaked = documents.length - readable.length;
  if (leaked) log(`⚠️  ${leaked} answer key(s) already on this job — not read`);

  const files = await Promise.all(
    readable.map(async (doc) => {
      const { data, error } = await db.storage.from(doc.storage_bucket).download(doc.storage_path);
      if (error || !data) throw new Error(`Could not download ${doc.file_name}: ${error?.message ?? 'no data'}`);
      return {
        fileName: doc.file_name,
        pdf: Buffer.from(await data.arrayBuffer()),
        ...(doc.mime_type ? { mimeType: doc.mime_type } : {}),
      };
    }),
  );

  const t0 = Date.now();
  let { draft, docs } = await buildDraftFromDocuments(files, COMPANY_ID, jobId);
  log(`draft built in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${draft.items.length} line(s), ${draft.flags.length} flag(s)`);

  const { data: latest } = await db
    .from('job_drafts')
    .select('version')
    .eq('job_id', jobId)
    .eq('company_id', COMPANY_ID)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest?.version ?? 0) + 1;
  const { data: draftRow, error: draftError } = await db
    .from('job_drafts')
    .insert({
      company_id: COMPANY_ID,
      job_id: jobId,
      draft: draft as never,
      version,
      created_by: UPLOADED_BY,
    })
    .select('id')
    .single();
  if (draftError || !draftRow) throw new Error(`Could not file the draft: ${draftError?.message}`);

  // 4. The workbook — with the operator answering the questions that are
  //    theirs to answer, and the draft re-resolved after each answer exactly
  //    as it is when they answer them on the job screen.
  const { data: job } = await db.from('jobs').select('id, reference').eq('id', jobId).single();
  const decisions: OperatorDecision[] = [];
  let result;
  let refusal: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      result = await buildLogisysWorkbook({
        draft: draft as unknown as ChecklistDraft,
        job: { id: jobId, reference: job?.reference ?? null },
      });
      refusal = undefined;
      break;
    } catch (err) {
      refusal = err as Error;
      const made = await decide(jobId, draft, blockersOf(refusal));
      if (made.length === 0) break;
      for (const d of made) log(`🧑 ${d.path} → ${d.choice} (${d.because})`);
      decisions.push(...made);
      draft = await applyJobResolution(draft, docs, COMPANY_ID, jobId);
      await db.from('job_drafts').update({ draft: draft as never }).eq('id', draftRow.id);
    }
  }

  if (!result) {
    // A blocker is a result, not a crash: it is the exporter refusing to file
    // something it cannot state truthfully, and it is exactly what the
    // comparison needs to see.
    log(`⛔ export refused: ${refusal?.message}`);
    return {
      folder,
      jobId,
      jobCreated,
      draftVersion: version,
      flags: draft.flags.length,
      decisions,
      status: 'blocked',
      error: refusal?.message ?? 'The export was refused.',
      fed,
      withheld,
      unreadable,
      finishedAt: new Date().toISOString(),
    };
  }

  const outDir = path.join(OUT_ROOT, folder);
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, result.fileName), result.buffer);
  await writeFile(
    path.join(outDir, 'report.json'),
    `${JSON.stringify(
      {
        folder,
        jobId,
        draftVersion: version,
        templateVersion: result.templateVersion,
        fileName: result.fileName,
        documentsRead: files.map((f) => f.fileName),
        answerKeysWithheld: withheld,
        notRead: unreadable,
        operatorDecisions: decisions,
        warnings: result.warnings,
        // What ICES would reject about this workbook, per its own published
        // codes, and the Logi-Sys-only rules kept apart from them. Advisory —
        // the workbook was produced either way. `scripts/ices-report.mts`
        // rolls these up across the corpus.
        ices: result.ices,
        flags: draft.flags,
      },
      null,
      2,
    )}\n`,
  );

  // File it where the app files it, so the export is downloadable from the job
  // page as well as sitting on disk here.
  const exportId = crypto.randomUUID();
  const storagePath = `${COMPANY_ID}/${jobId}/${exportId}.xlsx`;
  const { error: uploadError } = await db.storage.from('job-exports').upload(storagePath, result.buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: false,
  });
  if (!uploadError) {
    await db.from('job_exports').insert({
      id: exportId,
      company_id: COMPANY_ID,
      job_id: jobId,
      kind: 'logisys_xlsx',
      storage_path: storagePath,
      template_version: result.templateVersion,
      draft_version: version,
      generated_by: UPLOADED_BY,
    });
    await db
      .from('jobs')
      .update({ stage: 'exported', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('company_id', COMPANY_ID)
      .in('stage', ['new', 'documents_received']);
  } else {
    log(`⚠️  workbook written locally but not filed in storage: ${uploadError.message}`);
  }

  const icesCount = result.ices.findings.filter((f) => f.source === 'ices').length;
  log(
    `✅ ${result.fileName} — ${result.warnings.length} warning(s)` +
      (icesCount ? `, ${icesCount} ICES rejection(s)` : ''),
  );
  return {
    folder,
    jobId,
    jobCreated,
    draftVersion: version,
    exportFile: path.join(folder, result.fileName),
    warnings: result.warnings,
    icesFindings: icesCount,
    flags: draft.flags.length,
    decisions,
    status: 'ok',
    fed,
    withheld,
    unreadable,
    finishedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------- main

const folders = (await readdir(ERP_ROOT, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && /^(ex|liv)_job\d+$/.test(e.name))
  .map((e) => e.name)
  .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')))
  .sort((a, b) => a.replace(/\d+$/, '').localeCompare(b.replace(/\d+$/, '')));

state = await loadState();

const queue = folders.filter((f) => {
  if (ONLY && !ONLY.includes(f)) return false;
  if (SKIP.has(f)) return false;
  if (!FORCE && state[f]?.status === 'ok') return false;
  return true;
});

console.log(`corpus: ${queue.length} of ${folders.length} folder(s) to run${DRY_RUN ? ' (dry run)' : ''}\n`);
await mkdir(OUT_ROOT, { recursive: true });

let next = 0;
async function worker() {
  while (next < queue.length) {
    const folder = queue[next++]!;
    try {
      state[folder] = await runFolder(folder);
    } catch (err) {
      console.log(`[${folder}] ❌ ${(err as Error).message}`);
      state[folder] = {
        ...(state[folder] ?? { folder, status: 'failed' }),
        folder,
        status: 'failed',
        error: (err as Error).message,
        finishedAt: new Date().toISOString(),
      };
    }
    if (!DRY_RUN) await saveState();
  }
}

await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
if (!DRY_RUN) await saveState();

const rows = folders.filter((f) => state[f]).map((f) => state[f]!);
console.log('\n═══ corpus summary');
for (const r of rows) {
  const mark = r.status === 'ok' ? '✅' : r.status === 'blocked' ? '⛔' : r.status === 'pending' ? '·' : '❌';
  console.log(
    `${mark} ${r.folder.padEnd(10)} ${(r.exportFile ? path.basename(r.exportFile) : (r.error ?? '')).slice(0, 80)}` +
      (r.warnings?.length ? `  (${r.warnings.length} warnings)` : ''),
  );
}
const ok = rows.filter((r) => r.status === 'ok').length;
console.log(`\n${ok}/${rows.length} exported → ${OUT_ROOT}`);
