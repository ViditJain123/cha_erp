import { bcdExemptionNotification, lookupTariff, requiresIgcr } from '@checklist/core';
import type { AgentDecision, ChecklistDraft, DraftFlag, DraftItem } from '../draft.js';
import { retargetItemCth } from '../items-resolve.js';
import { isPrimaryEvidence, reasonRefuses, type AgentEvidence, type AgentItemResult, type JobAgentResult } from './output.js';
import { CandidateRegistry } from './registry.js';

/**
 * Write the agent's answer onto the draft — the part of the agent that is
 * pure, and the part that says no.
 *
 * Every decision passes three checks before it touches a line:
 *
 *   1. **Registry.** The value was returned by a tool in this run. A CTH the
 *      model typed, a serial it remembered, a number it read on a web page:
 *      refused, and the refusal is a flag carrying the model's evidence.
 *   2. **Agreement.** The reason beside the value does not argue against it,
 *      and the description-matches answer is yes.
 *   3. **Condition.** An entry with a condition names the document or mail
 *      that meets it. IGCR entries, List entries and stale entries are never
 *      filed from here whatever the answer says.
 *
 * A person's decision is never overwritten (`sources.* === 'operator'`), and
 * everything applied or refused is recorded on `item.agent` so the items panel
 * can show why.
 */
export interface ApplyOptions {
  fileNames: string[];
  model: string;
  at: string;
}

export interface ApplyOutcome {
  draft: ChecklistDraft;
  decisions: AgentDecision[];
  flagsAdded: number;
}

function evidenceLines(evidence: AgentEvidence[]): string[] {
  return evidence.slice(0, 4).map((e) => `"${e.quote.replace(/\s+/g, ' ').trim().slice(0, 200)}" — ${e.document}`);
}

function evidenceText(evidence: AgentEvidence[]): string {
  const lines = evidenceLines(evidence);
  return lines.length ? ` Evidence: ${lines.join('; ')}.` : '';
}

/**
 * Evidence that is only the web.
 *
 * The model cites a tool result the way it cites a page — "Tariff master —
 * 34039900", "Compensation cess candidates" — and those are neither a job
 * file nor the web. Only a `web:` reference or a URL is the web; a decision
 * rests on the web alone when every citation is one of those.
 */
function isWebEvidence(document: string): boolean {
  return /^web:|^https?:\/\//i.test(document.trim());
}

function allWeb(evidence: AgentEvidence[], _fileNames: Set<string>): boolean {
  return evidence.length > 0 && evidence.every((e) => isWebEvidence(e.document));
}


export function applyAgentResult(draft: ChecklistDraft, result: JobAgentResult, registry: CandidateRegistry, opts: ApplyOptions): ApplyOutcome {
  const out: ChecklistDraft = { ...draft, items: draft.items.map((i) => ({ ...i })), flags: [...draft.flags] };
  const fileNames = new Set(opts.fileNames);
  const decisions: AgentDecision[] = [];
  let flagsAdded = 0;
  const flag = (f: DraftFlag) => {
    out.flags.push(f);
    flagsAdded++;
  };

  for (const answer of result.items) {
    const idx = out.items.findIndex((i) => i.invoiceSrNo === answer.invoiceSrNo && i.slNo === answer.slNo);
    if (idx < 0) continue;
    let item: DraftItem = out.items[idx]!;
    const label = `Item ${item.invoiceSrNo}/${item.slNo}`;
    const at = (field: string) => `items.${idx}.${field}`;
    const itemDecisions: AgentDecision[] = [];
    const record = (d: AgentDecision) => {
      itemDecisions.push(d);
      decisions.push(d);
    };

    item = applyCth(item, answer, { label, at, flag, record, registry, fileNames, out });
    item = applyBcd(item, answer, { label, at, flag, record, registry, fileNames, out });
    item = applySerial(item, answer, 'igst', { label, at, flag, record, registry, fileNames, out });
    item = applySerial(item, answer, 'compCess', { label, at, flag, record, registry, fileNames, out });
    item = applyExim(item, answer, { label, at, flag, record, registry, fileNames, out });

    for (const c of answer.conflicts) {
      flag({
        severity: c.severity,
        path: at(conflictField(c.field)),
        message: `Agent: ${c.field} differs between ${c.documents.join(' and ')} (${c.values.join(' vs ')}). ${c.resolution}`,
      });
      record({ field: 'conflict', value: `${c.field}: ${c.values.join(' vs ')}`, applied: false, reason: c.resolution, confidence: 'medium', evidence: c.documents });
    }
    for (const q of answer.openQuestions) {
      flag({ severity: 'warning', path: at('agent'), message: `Agent asks: ${q}` });
    }

    item = { ...item, agent: { model: opts.model, at: opts.at, decisions: itemDecisions, openQuestions: answer.openQuestions } };
    out.items[idx] = item;
  }

  for (const c of result.jobConflicts) {
    flag({ severity: c.severity, path: 'agent.conflict', message: `Agent: ${c.field} differs between ${c.documents.join(' and ')} (${c.values.join(' vs ')}). ${c.resolution}` });
  }
  for (const w of result.webFindings) {
    const idx = w.aboutItemSlNo == null ? -1 : out.items.findIndex((i) => i.slNo === w.aboutItemSlNo);
    flag({
      severity: 'info',
      path: idx >= 0 ? `items.${idx}.agent` : 'agent.web',
      message: `Agent (web, not filed): ${w.claim} — ${w.url} "${w.quote.slice(0, 200)}"`,
    });
  }

  return { draft: out, decisions, flagsAdded };
}

interface Ctx {
  label: string;
  at: (field: string) => string;
  flag: (f: DraftFlag) => void;
  record: (d: AgentDecision) => void;
  registry: CandidateRegistry;
  fileNames: Set<string>;
  out: ChecklistDraft;
}

function conflictField(field: string): string {
  const f = field.toLowerCase();
  if (f.includes('origin')) return 'originCountry';
  if (f.includes('fta') || f.includes('prefer')) return 'fta';
  if (f.includes('quant')) return 'quantity';
  if (f.includes('desc')) return 'description';
  if (f.includes('value') || f.includes('price') || f.includes('amount')) return 'amount';
  return 'agent';
}

function applyCth(item: DraftItem, answer: AgentItemResult, ctx: Ctx): DraftItem {
  const d = answer.cth;
  const cth = (d.cth ?? '').replace(/\D/g, '');
  const base = { field: 'cth', reason: d.reason, confidence: d.confidence, evidence: evidenceLines(d.evidence) };
  if (!d.decided || !cth) {
    ctx.record({ ...base, value: null, applied: false });
    return item;
  }
  if (item.sources?.ritc === 'operator' || item.sources?.ritc === 'master') {
    ctx.record({ ...base, value: cth, applied: false, reason: `${d.reason} (a ${item.sources.ritc} decision stands)` });
    return item;
  }
  if (!ctx.registry.cth.has(cth)) {
    ctx.flag({ severity: 'error', path: ctx.at('ritc'), message: `Agent proposed CTH ${cth} — not a tariff item any tool returned in this run, so it is not applied. ${d.reason}${evidenceText(d.evidence)}` });
    ctx.record({ ...base, value: cth, applied: false, reason: `not a candidate: ${d.reason}` });
    return item;
  }
  if (reasonRefuses(d.reason) || d.confidence === 'low') {
    ctx.flag({ severity: 'warning', path: ctx.at('ritc'), message: `Agent suggests CTH ${cth} but ${d.confidence === 'low' ? 'with low confidence' : 'its own reasoning argues against it'}: ${d.reason}${evidenceText(d.evidence)}` });
    ctx.record({ ...base, value: cth, applied: false });
    return item;
  }
  const row = lookupTariff(cth);
  if (cth === item.ritc) {
    ctx.flag({ severity: 'info', path: ctx.at('ritc'), message: `Agent confirms CTH ${cth}${row ? ` "${row.description.slice(0, 60)}"` : ''}: ${d.reason} Considered ${d.considered.join(', ') || cth}.` });
    ctx.record({ ...base, value: cth, applied: true });
    return { ...item, sources: { ...item.sources, ritc: item.sources?.ritc ?? 'agent' } };
  }
  const retargeted = retargetItemCth(item, cth);
  // The blocking classification flag, if any, is answered by this.
  ctx.out.flags = ctx.out.flags.filter((f) => !(f.path === ctx.at('ritc') && f.severity === 'error'));
  ctx.flag({
    severity: 'warning',
    path: ctx.at('ritc'),
    message: `Agent classified as CTH ${cth}${row ? ` "${row.description.slice(0, 60)}" (BCD ${row.bcdRate}%, IGST ${row.igstRate}%)` : ''}, was ${item.ritc || '(none)'}: ${d.reason} Considered ${d.considered.join(', ') || cth}. Confirm before filing.${evidenceText(d.evidence)}`,
  });
  ctx.record({ ...base, value: cth, applied: true });
  return { ...retargeted, sources: { ...retargeted.sources, ritc: 'agent' } };
}

function applyBcd(item: DraftItem, answer: AgentItemResult, ctx: Ctx): DraftItem {
  const d = answer.bcd;
  const base = { field: 'bcd', reason: d.reason, confidence: d.confidence, evidence: evidenceLines(d.evidence) };
  const value = d.notification && d.serial ? `${d.notification} S.No. ${d.serial}${d.subEntry ? ` ${d.subEntry}` : ''}` : null;
  if (!d.applies || !d.notification || !d.serial) {
    ctx.record({ ...base, value, applied: false });
    return item;
  }
  if (item.sources?.notifications === 'operator') {
    ctx.record({ ...base, value, applied: false, reason: `${d.reason} (an operator decision stands)` });
    return item;
  }
  const propose = (severity: DraftFlag['severity'], why: string) => {
    ctx.flag({ severity, path: ctx.at('bcdRate'), message: `Agent proposes BCD concession ${value} — NOT applied: ${why}. ${d.reason}${evidenceText(d.evidence)}` });
    ctx.record({ ...base, value, applied: false, reason: `${why}: ${d.reason}` });
    return item;
  };
  const reg = ctx.registry.bcd.get(CandidateRegistry.bcdKey(d.notification, d.serial, d.subEntry));
  if (!reg) return propose('error', 'not an entry any tool returned in this run');
  if (allWeb(d.evidence, ctx.fileNames)) return propose('error', 'its only evidence is the web');
  if (!d.descriptionMatches || reasonRefuses(d.reason)) return propose('warning', 'the agent\'s own reasoning says the goods do not meet the entry');
  if (!reg.filable) return propose('warning', reg.why ?? 'the entry is not filable');
  if (requiresIgcr(reg.entry, reg.subEntry)) return propose('warning', 'the entry needs the importer\'s IGCR registration and bond, which no document establishes');
  const conditioned = reg.subEntry ? true : reg.entry.conditions.length > 0;
  if (conditioned) {
    const by = d.conditionEstablishedBy;
    if (!by || !isPrimaryEvidence(by.document, ctx.fileNames)) {
      return propose('warning', `the entry carries condition ${reg.entry.condition ?? reg.entry.conditions.join('/')} and no document or mail on the job establishes it`);
    }
  }
  const sub = reg.subEntry ? reg.entry.subEntries?.find((s) => s.label === reg.subEntry) : undefined;
  const rate = sub ? sub.bcdRate : reg.entry.bcdRate;
  if (rate == null) return propose('warning', `rate "${sub?.bcdRateText ?? reg.entry.bcdRateText}" is not a single ad valorem figure; enter it by hand`);
  const printed = lookupTariff(item.ritc)?.notificationRefs?.find((r) => r.notification === bcdExemptionNotification() && r.serial);
  const corroboration = !printed ? '' : printed.serial === reg.entry.serial ? ' The printed tariff cites the same entry.' : ` The printed tariff cites S.No. ${printed.serial} for this code instead — one of the two is wrong about these goods.`;
  ctx.flag({
    severity: 'warning',
    path: ctx.at('bcdRate'),
    message: `Agent applied BCD ${rate}% from ${value} (Table ${reg.entry.table}): ${d.reason}${d.conditionEstablishedBy ? ` Condition met by ${d.conditionEstablishedBy.document}: "${d.conditionEstablishedBy.quote.slice(0, 160)}".` : ''}${corroboration} Confirm before filing.${evidenceText(d.evidence)}`,
  });
  ctx.record({ ...base, value, applied: true });
  const { bcdExemption: _e, ...rest } = item;
  return {
    ...rest,
    bcdRate: rate,
    bcdNotification: bcdExemptionNotification(),
    notificationSerials: { ...item.notificationSerials, basic: reg.entry.serial },
    sources: { ...item.sources, notifications: 'agent' },
  };
}

function applySerial(item: DraftItem, answer: AgentItemResult, kind: 'igst' | 'compCess', ctx: Ctx): DraftItem {
  const d = answer[kind];
  const base = { field: kind, reason: d.reason, confidence: d.confidence, evidence: evidenceLines(d.evidence) };
  if (!d.decided || !d.serial) {
    ctx.record({ ...base, value: d.serial, applied: false });
    return item;
  }
  if (item.sources?.notifications === 'operator') {
    ctx.record({ ...base, value: d.serial, applied: false, reason: `${d.reason} (an operator decision stands)` });
    return item;
  }
  const path = ctx.at(kind === 'igst' ? 'igstRate' : 'compCessRate');
  const reg = kind === 'igst'
    ? [...ctx.registry.igst.values()].find((r) => `${r.entry.schedule}${r.entry.serial}` === d.serial)
    : [...ctx.registry.cess.values()].find((r) => r.entry.serial === d.serial);
  if (!reg || allWeb(d.evidence, ctx.fileNames)) {
    const why = reg ? 'its only evidence is the web' : 'not an entry any tool returned in this run';
    ctx.flag({ severity: 'error', path, message: `Agent proposed ${kind === 'igst' ? 'IGST' : 'compensation cess'} serial ${d.serial} — ${why}, so it is not applied. ${d.reason}${evidenceText(d.evidence)}` });
    ctx.record({ ...base, value: d.serial, applied: false, reason: `${why}: ${d.reason}` });
    return item;

  }
  if (reasonRefuses(d.reason)) {
    ctx.flag({ severity: 'warning', path, message: `Agent suggests serial ${d.serial} but its own reasoning argues against it: ${d.reason}` });
    ctx.record({ ...base, value: d.serial, applied: false });
    return item;
  }
  const current = item.notificationSerials?.[kind];
  const rate = reg.entry.rate;
  const changed = current !== d.serial;
  if (kind === 'compCess' && rate == null) {
    const rateText = 'rateText' in reg.entry ? reg.entry.rateText : '';
    ctx.flag({ severity: 'error', path, message: `Agent chose cess S.No. ${d.serial} "${rateText}": ${d.reason} — the rate is specific or compound; enter the cess amount by hand.` });

  } else {
    ctx.flag({
      severity: changed ? 'warning' : 'info',
      path,
      message: `Agent ${changed ? 'set' : 'confirms'} ${kind === 'igst' ? 'IGST' : 'compensation cess'} ${rate}% from ${reg.notification} S.No. ${d.serial}: ${d.reason}${changed ? ' — verify against the goods.' : ''}`,
    });
  }
  ctx.record({ ...base, value: d.serial, applied: true });
  const serials = { ...item.notificationSerials, [kind]: d.serial };
  return {
    ...item,
    ...(kind === 'igst' ? { igstRate: rate ?? item.igstRate, igstNotification: reg.notification } : { compCessNotification: reg.notification, ...(rate != null && { compCessRate: rate }) }),
    notificationSerials: serials,
    sources: { ...item.sources, notifications: changed ? 'agent' : (item.sources?.notifications ?? 'agent') },
  };
}

function applyExim(item: DraftItem, answer: AgentItemResult, ctx: Ctx): DraftItem {
  const d = answer.exim;
  const base = { field: 'exim', reason: d.reason, confidence: 'high' as const, evidence: evidenceLines(d.evidence) };
  if (!d.applies || !d.notification) {
    ctx.record({ ...base, value: d.notification, applied: false });
    return item;
  }
  if (item.sources?.eximScheme === 'operator') {
    ctx.record({ ...base, value: d.notification, applied: false, reason: `${d.reason} (an operator decision stands)` });
    return item;
  }
  const key = d.notification.trim();
  const reg = [...ctx.registry.exim.entries()].find(([k]) => k === key || k === key.padStart(8, '0'))?.[1];
  const licenceOnJob = (d.licenceFile && ctx.fileNames.has(d.licenceFile)) || d.evidence.some((e) => isPrimaryEvidence(e.document, ctx.fileNames));
  const value = `${reg?.entry.notification ?? d.notification}${d.licenceNo ? ` (licence ${d.licenceNo}${d.licenceDate ? ` of ${d.licenceDate}` : ''})` : ''}`;
  if (!reg || !licenceOnJob) {
    ctx.flag({
      severity: reg ? 'warning' : 'error',
      path: ctx.at('eximScheme'),
      message: `Agent proposes a scheme claim under ${value} — NOT applied: ${reg ? 'no licence on the job or in the mail is quoted for it' : 'not a scheme notification any tool returned in this run'}. ${d.reason}${evidenceText(d.evidence)}`,
    });
    ctx.record({ ...base, value, applied: false, reason: `${reg ? 'no licence evidence' : 'not a candidate'}: ${d.reason}` });
    return item;
  }
  ctx.flag({
    severity: 'warning',
    path: ctx.at('eximScheme'),
    message: `Agent set Exim scheme ${reg.code} under ${reg.entry.notification} S.No. ${reg.entry.serial}${d.licenceFile ? ` from ${d.licenceFile}` : ''}${d.licenceNo ? ` — licence ${d.licenceNo}${d.licenceDate ? ` dated ${d.licenceDate}` : ''}` : ''}: ${d.reason} Record the licence on the job before filing.${evidenceText(d.evidence)}`,
  });
  ctx.record({ ...base, value, applied: true });
  return {
    ...item,
    eximScheme: { ...item.eximScheme, code: reg.code, notification: reg.entry.notification, serial: reg.entry.serial },
    ...(reg.entry.igstExemption && { igstExemption: { ...reg.entry.igstExemption, type: 'C' as const } }),
    sources: { ...item.sources, eximScheme: 'agent' },
  };
}
