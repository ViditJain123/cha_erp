import {
  BCD_EXEMPTION_EFFECTIVE_FROM,
  aidcLevyFor,
  bcdConditions,
  bcdExemptionLapsed,
  bcdExemptionMatches,
  bcdExemptionNotification,
  bcdExemptionNotificationOn,
  bcdSubEntryConditions,
  chapterNotes,
  compCessMatches,
  compCessNotification,
  eximSchemeEntry,
  eximSchemeForNotification,
  eximSchemeName,
  ftaAgreementForCertificate,
  ftaAgreementsForOrigin,
  ftaConcessionFor,
  igstRateForCth,
  igstScheduleMatches,
  isStale,
  iso2,
  logisysNotn,
  lookupTariff,
  pad8,
  requiresIgcr,
  resolveTariffPrefix,
  tariffDissent,
  type BcdExemptionEntry,
} from '@checklist/core';
import { searchLibrary } from '@checklist/library';
import { z } from 'zod';
import { classificationCandidates } from '../classify-propose.js';
import { readDocument, type AgentFile } from './documents.js';
import type { AnyToolDef, ToolOutput } from './loop.js';
import { lookupNotifications } from './notification-index.js';
import type { CandidateRegistry } from './registry.js';

/**
 * The job agent's tools: the duty and tariff masters, the CBIC index, the
 * notification library and the job's own files, each as a function the model
 * can call.
 *
 * Three rules shape every handler:
 *
 *   - **Trimmed.** A tool returns what a broker would read off the page it
 *     names — serial, rate, description, condition — not the row. Tokens are
 *     the budget, and a 2,000-character description is noise the model has to
 *     wade through to find the serial.
 *   - **Registered.** Anything filable a tool returns is written to the
 *     registry first. The final answer is checked against that, so a value the
 *     model did not get from a tool cannot reach the draft.
 *   - **Dated.** Every lookup takes the filing date from the context. Nothing
 *     that is not in force on that day is offered as filable.
 */
export interface ToolContext {
  files: AgentFile[];
  filingDate: string;
  registry: CandidateRegistry;
}

const CTH = z.string().describe('8-digit tariff item, digits only');

function clip(text: string | null | undefined, n: number): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function listRef(entry: BcdExemptionEntry): string | null {
  const m = /\bList\s+(\d+[A-Z]?)\b/i.exec(entry.description);
  return m ? `List ${m[1]}` : null;
}

function tariffRow(cth: string) {
  const row = lookupTariff(cth);
  if (!row) return null;
  return {
    cth: row.cth,
    description: clip(row.description, 200),
    unit: row.unit,
    bcdRate: row.bcdRate,
    effectiveBcdRate: row.effectiveBcdRate ?? null,
    igstRate: row.igstRate,
    impPolicy: row.impPolicy ?? 'Free',
    printedNotificationRefs: (row.notificationRefs ?? []).slice(0, 6).map((r) => ({ notification: r.notification, serial: r.serial ?? null })),
    remarks: clip(row.remarks, 160) || null,
  };
}

export function jobAgentTools(ctx: ToolContext): AnyToolDef[] {
  const { registry, filingDate } = ctx;
  const bcdNotification = bcdExemptionNotificationOn(filingDate);
  const bcdParsed = bcdNotification === bcdExemptionNotification();

  const defs: AnyToolDef[] = [

    {
      name: 'lookup_tariff',
      description: 'The First Schedule row for an 8-digit tariff item: description, unit, statutory and effective BCD, IGST, DGFT import policy, and the notifications the printed tariff cites against it.',
      parameters: z.object({ cth: CTH }),
      maxCalls: 20,
      handler: async (args: { cth: string }) => {
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        const row = tariffRow(cth);
        if (!row) return `No tariff item ${cth} in the First Schedule. Use resolve_tariff_prefix on its heading.`;
        registry.addCth(row.cth);
        const dissent = tariffDissent(cth).map((d) => ({ field: d.field, cbic: d.cbic, book: d.book, notification: d.notification, serial: d.serial }));
        return json({ ...row, dissent });
      },
    },
    {
      name: 'resolve_tariff_prefix',
      description: 'Every tariff item under a 4-to-7-digit heading or subheading, with description and rates. The last item of a subheading is usually its residual "Other".',
      parameters: z.object({ prefix: z.string().describe('4 to 7 digits') }),
      maxCalls: 20,
      handler: async (args: { prefix: string }) => {
        const digits = args.prefix.replace(/\D/g, '');
        if (digits.length < 4) return 'Error: give at least 4 digits.';
        const { reason, candidates } = resolveTariffPrefix(digits);
        const rows = candidates.slice(0, 25).map((r) => {
          registry.addCth(r.cth);
          return { cth: r.cth, description: clip(r.description, 120), bcdRate: r.bcdRate, igstRate: r.igstRate, impPolicy: r.impPolicy ?? 'Free' };
        });
        return json({ prefix: digits, reason, shown: rows.length, of: candidates.length, candidates: rows });
      },
    },
    {
      name: 'search_product_index',
      description: 'Tariff items the goods could be, found through the printed tariff\'s alphabetical product index and any partial HS code. A finding aid, not a classification: apply the Chapter Notes.',
      parameters: z.object({ description: z.string(), hsHint: z.string().nullable().describe('a partial HS code off the documents, or null') }),
      maxCalls: 20,
      handler: async (args: { description: string; hsHint: string | null }) => {
        const candidates = classificationCandidates({ description: args.description, ...(args.hsHint && { hsHint: args.hsHint }) });
        for (const c of candidates) registry.addCth(c.cth);
        return json(
          candidates.map((c) => ({
            cth: c.cth,
            description: clip(c.tariffDescription, 120),
            bcdRate: c.bcdRate,
            igstRate: c.igstRate,
            impPolicy: c.impPolicy ?? 'Free',
            indexTerm: c.indexTerm ?? null,
            page: c.citation.page,
          })),
        );
      },
    },
    {
      name: 'chapter_notes',
      description: 'The first Chapter Notes of a tariff chapter. Under the General Interpretative Rules these decide a contested heading before any description does.',
      parameters: z.object({ chapter: z.string().describe('2-digit chapter') }),
      maxCalls: 10,
      handler: async (args: { chapter: string }) => {
        const notes = chapterNotes(args.chapter.replace(/\D/g, '').slice(0, 2));
        if (!notes?.notes.length) return `No notes held for chapter ${args.chapter}.`;
        return json({ chapter: notes.chapter, title: notes.title ?? null, notes: notes.notes.slice(0, 6).map((n) => clip(n, 400)) });
      },
    },
    {
      name: 'bcd_candidates',
      description: `Basic customs duty concessions that could cover a tariff item on the filing date, from the effective-rate notification in force that day, with each entry's description, rate and conditions. Only entries marked filable may be filed; a List entry or a lapsed one is a proposal.`,
      parameters: z.object({ cth: CTH }),
      maxCalls: 20,
      handler: async (args: { cth: string }) => {
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        if (!bcdParsed) {
          return json({
            notification: bcdNotification,
            filingDate,
            applicable: false,
            note: `A filing dated ${filingDate} is assessed under ${bcdNotification}, which the masters do not parse (45/2025 applies from ${BCD_EXEMPTION_EFFECTIVE_FROM}). No concession can be filed from here; a person reads the notification.`,
            entries: [],
          });
        }
        const inForce = bcdExemptionMatches(cth, { onIsoDate: filingDate }).slice(0, 12);
        const lapsed = bcdExemptionLapsed(cth, filingDate).slice(0, 6);
        const printed = lookupTariff(cth)?.notificationRefs?.find((r) => r.notification === bcdExemptionNotification() && r.serial)?.serial ?? null;
        const entries = inForce.map((e) => {
          const list = listRef(e);
          const stale = isStale(e, filingDate);
          const igcr = requiresIgcr(e);
          const why = stale ? 'amended by a notification not folded into the masters' : list ? `${list} contents are not in the masters` : undefined;
          registry.addBcd(bcdNotification, { entry: e, filable: !stale && !list, ...(why && { why }) });
          for (const sub of e.subEntries ?? []) {
            registry.addBcd(bcdNotification, { entry: e, subEntry: sub.label, filable: !stale && !list, ...(why && { why }) });
          }
          return {
            table: e.table,
            serial: e.serial,
            rateText: e.bcdRateText,
            rate: e.bcdRate,
            description: clip(e.description, 300),
            conditions: bcdConditions(e).map((c) => ({ no: c.no, kinds: c.kinds, summary: clip(c.text, 160) })),
            subEntries: (e.subEntries ?? []).slice(0, 8).map((s) => ({
              label: s.label,
              text: clip(s.text, 80),
              rateText: s.bcdRateText,
              conditions: bcdSubEntryConditions(e, s.label).map((c) => c.no),
            })),
            filable: !stale && !list,
            stale,
            listRef: list,
            requiresIgcr: igcr,
            page: e.page ?? null,
          };
        });
        return json({
          notification: bcdNotification,
          filingDate,
          applicable: true,
          printedTariffCitesSerial: printed,
          entries,
          lapsed: lapsed.map((e) => ({ serial: e.serial, validUntil: e.validUntil ?? null })),
        });
      },
    },
    {
      name: 'igst_candidates',
      description: 'IGST rate schedule entries naming a tariff item on the filing date. When scheduleKnown is false the filing predates 9/2025 and the serial must be read from 1/2017-IT(R) by a person — do not file a serial.',
      parameters: z.object({ cth: CTH }),
      maxCalls: 20,
      handler: async (args: { cth: string }) => {
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        const result = igstRateForCth(cth, { onIsoDate: filingDate });
        if (!result) return `Error: ${args.cth} is not a usable code.`;
        const entries = igstScheduleMatches(cth).slice(0, 8);
        if (result.scheduleKnown) {
          for (const e of entries) registry.addIgst(result.notification, e);
          if (result.residual) registry.addIgst(result.notification, result.entry);
        }
        return json({
          notification: result.notification,
          filingDate,
          scheduleKnown: result.scheduleKnown,
          residual: result.residual,
          current: { serial: `${result.entry.schedule}${result.entry.serial}`, rate: result.rate, description: clip(result.entry.description, 200) },
          entries: entries.map((e) => ({ serial: `${e.schedule}${e.serial}`, rate: e.rate, description: clip(e.description, 200) })),
        });
      },
    },
    {
      name: 'comp_cess_candidates',
      description: 'Compensation cess entries naming a tariff item (1/2017-Compensation Cess (Rate)). Goods no entry describes fall under the residual S.No. 56 and bear no cess.',
      parameters: z.object({ cth: CTH }),
      maxCalls: 20,
      handler: async (args: { cth: string }) => {
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        const notification = compCessNotification();
        const entries = compCessMatches(cth).filter((e) => !e.anyChapter).slice(0, 8);
        for (const e of entries) registry.addCess(notification, e);
        const residual = compCessMatches(cth).find((e) => e.serial === '56');
        if (residual) registry.addCess(notification, residual);
        return json({
          notification,
          residualSerial: '56',
          entries: entries.map((e) => ({ serial: e.serial, rateText: e.rateText, rate: e.rate, description: clip(e.description, 200), brandSensitive: e.brandSensitive ?? false })),
        });
      },
    },
    {
      name: 'read_notification_text',
      description: 'Passages of a notification\'s own text from the library, for a question about wording or conditions. Text only; a serial or number here is not a candidate until a candidates tool has returned it.',
      parameters: z.object({ notification: z.string().describe('"045/2025", "021/2023"'), query: z.string() }),
      maxCalls: 4,
      handler: async (args: { notification: string; query: string }) => {
        const notification = logisysNotn(args.notification) ?? args.notification;
        const hits = await searchLibrary(args.query, { topK: 3, notifications: [notification] }).catch(() => []);
        if (!hits.length) return `No text of ${notification} is in the library for "${args.query}".`;
        return json(hits.map((h) => ({ title: clip(h.title, 100), page: h.page, text: clip(h.text, 1200) })));
      },
    },
    {
      name: 'lookup_notification',
      description: 'The CBIC index: whether a notification number exists, its title, series, date and whether it is amended or omitted; or a title search. Confirms a number; never supplies a serial.',
      parameters: z.object({ number: z.string().nullable().describe('"45/2025", "021/2023", "9/2025-IT(R)"'), query: z.string().nullable() }),
      maxCalls: 4,
      handler: async (args: { number: string | null; query: string | null }) => {
        if (!args.number && !args.query) return 'Error: give a number or a query.';
        const rows = lookupNotifications(args);
        if (!rows.length) return 'Nothing in the CBIC index matches.';
        for (const r of rows) if (r.ices) registry.addNotification(r.ices);
        return json(rows.map((r) => ({ number: r.notificationNo, ices: r.ices, title: clip(r.name, 160), category: r.category, date: r.date, amended: r.amended, omitted: r.omitted })));
      },
    },
    {
      name: 'exim_scheme_for_licence',
      description: 'What a licence or authorisation claim files: the Exim scheme code for the notification the licence is issued under (021/2023 Advance Authorisation, 026/2023 EPCG, 025/2023 DFIA …), the Exim notification and serial, the IGST exemption line if the scheme carries one, and the AIDC serial that follows.',
      parameters: z.object({ notification: z.string(), cth: CTH }),
      maxCalls: 6,
      handler: async (args: { notification: string; cth: string }) => {
        const code = eximSchemeForNotification(args.notification);
        const entry = eximSchemeEntry(args.notification);
        if (!code || !entry) return `${args.notification} is not a scheme notification the ICES directory maps to an Exim code. Check the number with lookup_notification.`;
        registry.addExim(code, entry);
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        const aidc = aidcLevyFor(cth, filingDate, { notification: '', scheme: code });
        return json({
          code,
          name: eximSchemeName(code) ?? null,
          exim: { notification: entry.notification, serial: entry.serial },
          igstExemption: entry.igstExemption ? { ...entry.igstExemption, type: 'C' } : null,
          aidcSerial: aidc?.serial ?? null,
          note: 'File only against a licence that is on the job or named in the mail; quote its number and date from the document.',
        });
      },
    },
    {
      name: 'fta_check',
      description: 'Whether a preferential (FTA/CEPA) concession exists for a tariff item from an origin country on the filing date, and the notification and serial it files under. The claim itself is filed by the resolver from the certificate; report conflicts, do not file.',
      parameters: z.object({ cth: CTH, originCountry: z.string().describe('country name or ISO-2'), schemeText: z.string().nullable().describe('the certificate\'s scheme heading, or null') }),
      maxCalls: 6,
      handler: async (args: { cth: string; originCountry: string; schemeText: string | null }) => {
        const cth = pad8(args.cth) ?? args.cth.replace(/\D/g, '');
        const origin = iso2(args.originCountry) ?? args.originCountry.trim().toUpperCase().slice(0, 2);
        const agreements = args.schemeText
          ? [ftaAgreementForCertificate(args.schemeText, origin, filingDate)].filter((a): a is NonNullable<typeof a> => Boolean(a))
          : ftaAgreementsForOrigin(origin, filingDate);
        if (!agreements.length) return `No trade agreement with ${origin} is in force on ${filingDate}${args.schemeText ? ` for a certificate headed "${clip(args.schemeText, 60)}"` : ''}.`;
        const out = agreements.map((a) => {
          const c = ftaConcessionFor(a, cth, filingDate);
          if (c) registry.addFta(c);
          return {
            agreement: a.key,
            name: a.name,
            concession: c ? { notification: c.notification, serial: c.serial, slot: c.slot, rateText: c.rateText, description: clip(c.description, 120), rivals: c.rivals } : null,
          };
        });
        return json({ origin, filingDate, agreements: out });
      },
    },
    {
      name: 'read_document',
      description: 'Read a job file: its text layer by page, or the file itself as an image when it has none (a scanned licence). Use it for a document not already extracted, or to settle a conflict between documents. Costly; ask for the pages you need.',
      parameters: z.object({
        fileName: z.string(),
        pages: z.array(z.number()).nullable().describe('1-based page numbers, or null for the first pages'),
        mode: z.enum(['text', 'image']),
      }),
      maxCalls: 3,
      handler: async (args: { fileName: string; pages: number[] | null; mode: 'text' | 'image' }): Promise<ToolOutput> => readDocument(ctx.files, args),
    },
  ];
  return defs;
}
