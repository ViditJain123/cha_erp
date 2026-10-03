import 'server-only';
import { isValidContainerNumber, normaliseContainerNumber } from '@checklist/core';
import type { ChecklistDraft } from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Resolving the container list — the CONTAINERS sheet.
 *
 * Two sources, in the same order of precedence as everything else on the Bill
 * of Entry: what the documents said, then what the operator decided.
 *
 *   - The draft's own list, read from every bill of lading on the job.
 *   - Container numbers ingest already pulled off the attachments into
 *     `job_identifiers` (kind `container`) when the mail arrived. These are a
 *     second, independent reading of the same documents — triage asks for
 *     "every container number shown" — so a number that is there and not in the
 *     draft is a box the extraction dropped, and it is added rather than lost.
 *   - `job_containers`, the operator's own list. When it has rows they ARE the
 *     list: a person who has typed a container list has looked at the B/L, and
 *     nothing read off a scan outranks that.
 *
 * The operator layer is also what makes "read the documents again" safe. The
 * draft is rebuilt from the PDFs on every re-read, and this runs over the top
 * of the rebuilt draft, so a corrected list survives.
 */

type ContainerRow = Database['public']['Tables']['job_containers']['Row'];
type DraftContainer = ChecklistDraft['shipment']['containers'][number];

export interface JobContainer {
  id: string;
  srNo: number;
  containerNo: string;
  sealNo: string | null;
  sizeType: string | null;
}

function fromRow(row: ContainerRow): JobContainer {
  return {
    id: row.id,
    srNo: row.sr_no,
    containerNo: row.container_no,
    sealNo: row.seal_no,
    sizeType: row.size_type,
  };
}

/** The operator's container rows for a job, in declaration order. */
export async function operatorContainers(
  jobId: string,
  companyId: string,
): Promise<JobContainer[]> {
  const db = serviceClient();
  const { data } = await db
    .from('job_containers')
    .select('*')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .order('sr_no', { ascending: true });
  return (data ?? []).map(fromRow);
}

/** Container numbers ingest recorded against the job when the mail arrived. */
async function identifierContainers(jobId: string, companyId: string): Promise<string[]> {
  const db = serviceClient();
  const { data } = await db
    .from('job_identifiers')
    .select('value, value_raw')
    .eq('job_id', jobId)
    .eq('company_id', companyId)
    .eq('kind', 'container');
  return (data ?? []).map((r) => r.value_raw || r.value);
}

function toDraftContainer(c: JobContainer): DraftContainer {
  return {
    number: c.containerNo,
    ...(c.sizeType ? { sizeType: c.sizeType } : {}),
    ...(c.sealNo ? { sealNo: c.sealNo } : {}),
  };
}

/**
 * Fill `draft.shipment.containers` from the documents, ingest and the operator.
 *
 * Runs last in the draft pipeline, like the other resolution steps: it needs a
 * company and a database, which is why it cannot live inside the merge.
 */
export async function applyContainerResolution(
  draft: ChecklistDraft,
  companyId: string,
  jobId: string,
): Promise<ChecklistDraft> {
  const [operator, identifiers] = await Promise.all([
    operatorContainers(jobId, companyId),
    identifierContainers(jobId, companyId),
  ]);

  // The merge's own container flags are recomputed here from whatever the final
  // list turns out to be, so an operator who has fixed the list does not keep
  // reading the warning that made them fix it.
  const flags = draft.flags.filter((f) => f.path !== 'shipment.containers');
  const warn = (message: string) =>
    flags.push({ severity: 'warning', path: 'shipment.containers', message });
  const info = (message: string) =>
    flags.push({ severity: 'info', path: 'shipment.containers', message });

  const stated = draft.shipment.containerCountStated;
  let containers: DraftContainer[];

  if (operator.length > 0) {
    containers = operator.map(toDraftContainer);
    info(
      `Container list keyed on the job: ${operator.length} container${operator.length === 1 ? '' : 's'}. ` +
        'It replaces what the documents were read to say.',
    );
  } else {
    containers = [...draft.shipment.containers];
    const known = new Set(containers.map((c) => normaliseContainerNumber(c.number)));
    const missed = identifiers.filter((raw) => !known.has(normaliseContainerNumber(raw)));
    for (const raw of missed) containers.push({ number: raw });
    if (missed.length) {
      info(
        `${missed.length} container number${missed.length === 1 ? '' : 's'} found on the attachments ` +
          `when they arrived (${missed.join(', ')}) ${missed.length === 1 ? 'was' : 'were'} not in the ` +
          'reading of the bill of lading. Added without a size or seal — check them against the B/L.',
      );
    }

    // A scan read twice is a scan misread twice. Both sources above are
    // readings of the same paper, and a misreading of a box already in the list
    // arrives looking like another box: ex_job26 read UETU5715694 three ways
    // and would have declared seven containers against the B/L's five. Six of
    // the seven corpus jobs that declared the wrong number of containers were
    // this, and in every one the number of misreadings equalled the surplus.
    //
    // ISO 6346 settles it without guessing: the real number passes its check
    // digit and the variants do not. UETU5715694 checks to 4, TEIU5715694 to 0,
    // TETU5715694 to 3. A number that fails cannot be declared — it is not a
    // container number, and putting it on a Bill of Entry states a box that
    // does not exist — so it is dropped here rather than filed with a warning
    // beside it, which is what used to happen.
    //
    // Dropped, but never silently: each one is named, because the box may be
    // real and only the reading wrong, and then it is keyed on the job. The
    // operator's own list is not filtered at all — see above, a person who has
    // typed a container list has looked at the B/L.
    const misread = containers.filter((c) => !isValidContainerNumber(c.number));
    if (misread.length) {
      containers = containers.filter((c) => isValidContainerNumber(c.number));
      const numbers = misread.map((c) => c.number).join(', ');
      const agrees = stated != null && stated === containers.length;
      warn(
        `${misread.length} number${misread.length === 1 ? '' : 's'} read off the documents ` +
          `(${numbers}) ${misread.length === 1 ? 'fails its' : 'fail their'} ISO 6346 check digit, ` +
          `so ${misread.length === 1 ? 'it is' : 'they are'} not declared. ` +
          (agrees
            ? `The ${containers.length} that remain are exactly what the B/L states, so ` +
              `${misread.length === 1 ? 'it was' : 'they were'} a misreading of a box already on ` +
              'the list. Check them if you disagree.'
            : 'Check them against the B/L and key the right numbers on the job.'),
      );
    }
  }

  if (containers.length === 0) {
    if (draft.transportMode === 'Sea') {
      warn(
        'No containers on this job. The CONTAINERS sheet will be empty — add them before filing.',
      );
    }
  } else if (stated != null && stated !== containers.length) {
    warn(
      `The bill of lading states ${stated} container${stated === 1 ? '' : 's'} and the job carries ` +
        `${containers.length}. The Bill of Entry would declare ${containers.length}.`,
    );
  }

  // Only an operator's list can still hold one of these: the document path
  // above drops them. A person's typo is theirs to correct, so it is reported
  // and still filed rather than quietly removed from what they typed.
  for (const c of containers) {
    if (!isValidContainerNumber(c.number)) {
      warn(
        `Container number ${c.number} fails its ISO 6346 check digit — it is misread or mistyped.`,
      );
    }
  }

  return { ...draft, flags, shipment: { ...draft.shipment, containers } };
}
