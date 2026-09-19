import { isValidContainerNumber, normaliseContainerNumber } from '@checklist/core';
import { z } from 'zod';
import { MODELS, structuredPdfCall } from './openai.js';
import { ContainerSchema, type BlExtract, type Container } from './schemas.js';

/**
 * A second read of a bill of lading that asks for nothing but the containers.
 *
 * The main B/L call carries forty other fields, and the container list is the
 * one that loses: every job we hold comes back with a single box whatever the
 * document says, and `ex_job6` ("SAY : SIX CONTAINERS ONLY") and `liv_job1`
 * ("0004 CNTR") both have their numbers printed plainly on the page. A Bill of
 * Entry declaring one of six containers is not a smaller filing, it is a wrong
 * one, so when the first pass looks thin the document is read again by a model
 * that has been asked to do exactly one thing.
 */
export const ContainerListSchema = z.object({
  containers: z.array(ContainerSchema),
  /** The total the document states, in words or figures. */
  statedCount: z.number().nullable(),
  /** The words it states it in, so a disagreement can be judged rather than guessed at. */
  statedCountQuote: z.string().nullable(),
  /** Which block or page the list was read from — the audit trail for a re-read. */
  whereListed: z.string().nullable(),
});

export type ContainerList = z.infer<typeof ContainerListSchema>;

const SYSTEM = `You read the container manifest off an ocean bill of lading for an Indian customs house agent. You are asked for nothing else — no parties, no values, no weights, no dates.

Return every container the document lists, and the total it states.

Where containers are printed:
- A narrow "Container No./Seal No." column that repeats down the page, one line per box: "CAIU3686895 / QIN2410658 / 20GP / 1000 BAG(S)", then "CAIU3772397 / QIN2509082 / 20GP / 1000 BAG(S)", and so on. The description block beside it is written once; the column keeps going past where that text stops. Keep reading it.
- A stack of three-token lines under the marks block: "IAAU1141498 40SD96 IAAH479523" — number, size/type, seal.
- A "*** B/L Attached List ***", an appendix, a container manifest, or a continuation sheet on a later page. Read EVERY page of the file.
- A rider or annex that repeats the B/L number in its heading.

Rules:
- number: four letters then seven digits, exactly as printed. Never invent one, never complete a partly legible one from a pattern, and never renumber.
- sizeType: verbatim — "40SD96", "20GP", "45G1", "1 X HIGH CUBE 40", "40'". Do not normalise or convert it.
- sealNo: the seal belonging to THAT container. Seals are per box. Do not copy one seal across every row; null when the column is blank or unreadable.
- packagesStuffed: the packages stuffed in THAT container, when the row states them — the "1000 BAG(S)" in "CAIU3686895 / QIN2410658 / 20GP / 1000 BAG(S)". Null when only a consignment total is given.
- grossWeightKg: that container's own gross weight in kilograms, when the row states it. Null otherwise. Never divide a consignment total between the boxes.
- statedCount: the total the document declares — "SAY : SIX CONTAINERS ONLY" is 6, "6 CTRS" is 6, "Total No. of Pkgs/Cntrs 0004 CNTR" is 4, "1 X 40' FCL CONTAINER" is 1, "1 container" in a Carrier's Receipt box is 1. Null when the document declares no total.
- statedCountQuote: the text you read that total from, verbatim.
- whereListed: a short note on where the list came from ("container column on page 1", "attached list, page 2").
- A single-container bill of lading is perfectly normal. Return one entry when there is one container; do not pad a list to match a total you cannot actually read.

Before answering, count the entries you are returning and compare them with statedCount. If they disagree, the list is what you can actually read on the page — correct the list if you missed rows, and otherwise leave both as they are so the disagreement is visible.`;

/**
 * Whether the first pass's containers should be read again.
 *
 * One container is the shape of the bug, so it is a trigger even though plenty
 * of real jobs move exactly one box: the re-read confirms it rather than
 * assuming it, and `ex_job2`/`ex_job3`/`ex_job4` are all genuinely single-box.
 */
export function needsContainerReread(bl: Pick<BlExtract, 'containers' | 'containerCount'>): boolean {
  if (bl.containers.length <= 1) return true;
  if (bl.containerCount != null && bl.containerCount !== bl.containers.length) return true;
  return bl.containers.some((c) => !isValidContainerNumber(c.number));
}

/** Whichever of two readings of the same box says more. */
function richer(a: Container, b: Container): Container {
  const score = (c: Container) =>
    (c.sizeType ? 1 : 0) +
    (c.sealNo ? 1 : 0) +
    (c.packagesStuffed != null ? 1 : 0) +
    (c.grossWeightKg != null ? 1 : 0);
  return score(b) > score(a) ? b : a;
}

/**
 * Union of two container lists, keyed on the normalised number.
 *
 * A union rather than a replacement: the two passes read the same page and
 * either can see a row the other missed, and the cost of keeping a box that is
 * really there is nothing while the cost of dropping one is a wrong filing.
 * Order follows the first list, then whatever the second adds.
 */
export function mergeContainerLists(first: Container[], second: Container[]): Container[] {
  const byNumber = new Map<string, Container>();
  for (const c of [...first, ...second]) {
    const key = normaliseContainerNumber(c.number);
    if (!key) continue;
    const seen = byNumber.get(key);
    byNumber.set(key, seen ? richer(seen, c) : c);
  }
  return [...byNumber.values()];
}

/** One model call that reads only the container manifest. */
export async function readContainerList(
  fileName: string,
  pdf: Buffer,
  mimeType?: string,
): Promise<ContainerList> {
  const { data } = await structuredPdfCall({
    schema: ContainerListSchema,
    schemaName: 'container_list',
    system: SYSTEM,
    userText: 'List every container on this bill of lading.',
    fileName,
    pdf,
    ...(mimeType !== undefined ? { mimeType } : {}),
    model: MODELS.escalate,
    escalateModel: null,
  });
  return data;
}

/**
 * The first pass's B/L data with its container list confirmed against a second,
 * container-only read. Returns the same object when no re-read was warranted.
 */
export async function verifyContainers(
  bl: BlExtract,
  fileName: string,
  pdf: Buffer,
  mimeType?: string,
): Promise<{ bl: BlExtract; reread: ContainerList | null }> {
  if (!needsContainerReread(bl)) return { bl, reread: null };

  const list = await readContainerList(fileName, pdf, mimeType);
  const containers = mergeContainerLists(bl.containers, list.containers);
  return {
    bl: {
      ...bl,
      containers,
      // The dedicated pass is the better authority on the stated total: it was
      // asked for the quote it read it from and nothing else.
      containerCount: list.statedCount ?? bl.containerCount,
    },
    reread: list,
  };
}
