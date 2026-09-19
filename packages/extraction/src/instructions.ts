import { z } from 'zod';
import { MODELS, structuredTextCall } from './openai.js';

/**
 * Reading the customer's instructions out of the mail thread the documents
 * arrived on.
 *
 * Several columns of the Bill of Entry are stated nowhere else. Which custom
 * house to file at, whether the goods are being warehoused or cleared home,
 * whether duty is deferred, what the importer's own reference is, which bonded
 * warehouse the goods sit in and which into-bond BE an ex-bond clearance draws
 * against — none of that is on a bill of lading or an invoice, and all of it is
 * in the mail. Until this existed the system had no source for any of them and
 * filled several with constants.
 *
 * Every field comes back with the sentence it was read from. That is not
 * decoration: an operator confirming a Bill of Entry needs to see *why* it says
 * warehousing, and a quote they can check against the thread is the difference
 * between confirming and rubber-stamping.
 */

export const MailInstructionsSchema = z.object({
  /**
   * The custom house, exactly as the mail writes it — a name, a code, or a
   * city. Resolved against the master afterwards, never coded by the model.
   */
  customsHouse: z.string().nullable(),
  customsHouseQuote: z.string().nullable(),

  beType: z.enum(['home_consumption', 'warehousing', 'ex_bond']).nullable(),
  beTypeQuote: z.string().nullable(),

  /** True only when the mail actually asks for deferred duty payment. */
  deferredDuty: z.boolean().nullable(),
  deferredDutyQuote: z.string().nullable(),

  /** The importer's own reference: a PO number, an indent, a job code. */
  importerRefNo: z.string().nullable(),
  importerRefQuote: z.string().nullable(),

  /** A branch of the importer the mail names, when it names one. */
  branchName: z.string().nullable(),
  branchQuote: z.string().nullable(),

  /**
   * The bonded warehouse, when the thread names one — a code like MAA1U001, or
   * the warehouse's name. Only relevant to a warehousing or ex-bond filing.
   */
  warehouse: z.string().nullable(),
  warehouseQuote: z.string().nullable(),

  /** The earlier into-bond BE an ex-bond clearance is filed against. */
  inBondBeNo: z.string().nullable(),
  inBondBeQuote: z.string().nullable(),

  /** The warehousing bond executed with Customs. */
  bondNo: z.string().nullable(),
  bondQuote: z.string().nullable(),

  /**
   * What the importer says the goods are for — trading, manufacture, research,
   * repair, display — as the mail words it. Coded to an ICES end-use code
   * afterwards, never by the model.
   */
  endUse: z.string().nullable(),
  endUseQuote: z.string().nullable(),

  /**
   * Whether the importer wants the preferential (FTA/CEPA) rate claimed. True
   * when they ask for the benefit, false when they say not to claim it, null
   * when the thread does not say.
   */
  claimFtaBenefit: z.boolean().nullable(),
  claimFtaBenefitQuote: z.string().nullable(),

  /** Anything instruction-like the schema has no field for, verbatim. */
  otherInstructions: z.array(z.string()),
});

export type MailInstructions = z.infer<typeof MailInstructionsSchema>;

const SYSTEM = `You read a customs broker's email thread and extract the filing instructions the customer gave.

You are NOT summarising the thread. You are looking for a short list of specific decisions, and the honest answer for most of them on most threads is null.

RULES
- Return null for anything the thread does not actually say. Never infer, never fill a field from what is usual. A missing instruction is a real and common answer.
- For every value you return, also return the exact sentence or phrase you took it from, copied verbatim from the mail. If you cannot quote it, you did not read it — return null.
- Read the whole thread including quoted replies, but prefer the most recent instruction when the thread changes its mind.
- Ignore signatures, disclaimers, and the broker's own outgoing mail asking questions. An instruction is something the customer states, not something we asked.

customsHouse — the port or custom house to file the Bill of Entry at. Copy how the mail writes it: "Nhava Sheva", "JNPT", "INNSA1", "ICD Tughlakabad", "Sahar air cargo". Do not convert it to a code.

beType — which kind of Bill of Entry:
  warehousing      — the goods go into a bonded warehouse. Words: "in bond", "into bond", "bond", "bonding", "warehouse", "warehousing", "file in-bond BE".
  ex_bond          — the goods are being taken OUT of a bonded warehouse. Words: "ex bond", "ex-bond", "exbond", "clearance from warehouse", "release from bond".
  home_consumption — the mail explicitly says home consumption / normal clearance / for home use.
  null             — the mail says nothing about it. This is the common case.
  Be careful: "bond" also appears in unrelated phrases like "bond amount", "bank guarantee/bond", "continuity bond". Only return warehousing when the goods themselves are being warehoused.

deferredDuty — true only if the customer asks for duty to be paid under the deferred payment scheme ("deferred duty", "defer the duty", "under our AEO deferred payment"). false if they explicitly say to pay duty upfront / by TR6 / transaction-wise. null if the thread does not mention it.

importerRefNo — the importer's own reference for this consignment: a PO number, indent number, order number, or internal job reference they ask to be quoted. Not our job number, not the BL number, not the invoice number.

branchName — a branch or unit of the importer the mail names as the one filing ("for our Bhiwandi unit", "branch: MAIN").

warehouse — the customs bonded warehouse the goods are going into or coming out of. Return the eight-character warehouse code (four characters of port, one letter, three digits — e.g. MAA1U001) when the mail gives one, otherwise the warehouse's name as written. Only for warehousing/ex-bond threads; null on an ordinary home-consumption job.

inBondBeNo — the number of the earlier INTO-BOND Bill of Entry that an ex-bond clearance is being filed against. Only meaningful when the customer is clearing goods out of a warehouse. Not the invoice number, not the BL number, not a bond number.

endUse — what the customer says the imported goods are for: trading/resale, use in manufacture or their own factory ("actual use"), research and development, repair, exhibition. Copy the words. null when the thread does not say.

claimFtaBenefit — true when the customer asks us to claim the FTA/CEPA/preferential rate or to use the certificate of origin for a concession; false when they tell us not to claim it; null otherwise.

bondNo — the warehousing bond executed with Customs for these goods. This is the one place "bond" legitimately means a bond number, so read it carefully: a bank guarantee, a continuity bond for a different purpose, or a shipping-line container deposit is NOT this.

otherInstructions — any other filing instruction the customer gave that has no field above: first check, provisional assessment, a licence to be used, urgency. One string each, quoted from the mail.`;

/** A thread as the model sees it: newest last, quoted replies kept. */
export interface MailThreadMessage {
  from?: string | null;
  receivedAt?: string | null;
  subject?: string | null;
  body: string;
}

/** How much thread to send. Enough for a long negotiation, short of a novel. */
const MAX_CHARS = 60_000;

function renderThread(messages: MailThreadMessage[]): string {
  const rendered = messages
    .map((m, i) => {
      const head = [
        `--- message ${i + 1}`,
        m.receivedAt ? `date: ${m.receivedAt}` : null,
        m.from ? `from: ${m.from}` : null,
        m.subject ? `subject: ${m.subject}` : null,
      ]
        .filter(Boolean)
        .join('\n');
      // Already plain: `mailBodyToText` ran at ingest, in @checklist/graph.
      return `${head}\n\n${m.body.trim()}`;
    })
    .join('\n\n');
  // Trimmed from the front: the latest instruction is the one that counts.
  return rendered.length > MAX_CHARS ? rendered.slice(rendered.length - MAX_CHARS) : rendered;
}

/** Empty instructions — what a thread with nothing in it resolves to. */
export const NO_INSTRUCTIONS: MailInstructions = {
  customsHouse: null,
  customsHouseQuote: null,
  beType: null,
  beTypeQuote: null,
  deferredDuty: null,
  deferredDutyQuote: null,
  importerRefNo: null,
  importerRefQuote: null,
  branchName: null,
  branchQuote: null,
  warehouse: null,
  warehouseQuote: null,
  inBondBeNo: null,
  inBondBeQuote: null,
  bondNo: null,
  bondQuote: null,
  endUse: null,
  endUseQuote: null,
  claimFtaBenefit: null,
  claimFtaBenefitQuote: null,
  otherInstructions: [],
};

/**
 * Extract the filing instructions from a job's mail thread.
 *
 * Returns `NO_INSTRUCTIONS` for an empty thread rather than calling the model,
 * so a job created by dropping files on the screen costs nothing here.
 */
export async function extractMailInstructions(
  messages: MailThreadMessage[],
): Promise<MailInstructions> {
  const usable = messages.filter((m) => m.body?.trim());
  if (usable.length === 0) return NO_INSTRUCTIONS;

  return structuredTextCall({
    schema: MailInstructionsSchema,
    schemaName: 'mail_instructions',
    system: SYSTEM,
    userText: renderThread(usable),
    // The extraction model, not the cheap classifier: this decides what section
    // of the Customs Act the declaration is filed under.
    model: MODELS.extract,
  });
}
