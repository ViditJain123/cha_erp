import 'server-only';
import { branchNameForExport, partyNameKey } from '@checklist/core';
import type { ChecklistDraft, PartyMatchStatus } from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { recomputeDuty } from '@/lib/recompute';
import { serviceClient } from '@/lib/supabase/admin';

/**
 * Binding a party on a job to a row in the organization repository.
 *
 * Logi-Sys looks its parties up in its own repository by name, branch and AD
 * code — the GENERAL sheet has no IEC or GSTIN column to fall back on — so a
 * name taken off a bill of lading is a guess at a key. This resolves that
 * guess against the repository the CHA uploaded, and everything the workbook
 * writes about a party is then read back out of the matched row.
 *
 * Resolution never fails a job. An unmatched party keeps the extracted name
 * and the export warns; a wrong name is the operator's to fix, and blocking
 * the download would not tell them anything the warning does not.
 */

export type OrganizationRow = Database['public']['Tables']['organizations']['Row'];

/** Which slot on the job the party fills, and so which repository flag it needs. */
export type PartyRole = 'consignee' | 'shipper' | 'agent' | 'transporter';

/**
 * How the binding happened. Defined on the draft, because the draft is what
 * carries it from here to the job screen and the exporter.
 */
export type { PartyMatchStatus };

export interface PartyMatch {
  status: PartyMatchStatus;
  org?: OrganizationRow;
  /** Set when the status is 'ambiguous': the branches to choose between. */
  candidates?: OrganizationRow[];
}

/**
 * How close a trigram hit has to be before it is taken without asking.
 *
 * "ASIA SHIGEN INTERNATIONAL" against "ASIA SHIGEN INTERNATIONAL CO., LTD" is
 * the case this has to catch; two different Siemens subsidiaries are the case
 * it has to miss.
 */
const FUZZY_MIN_SIMILARITY = 0.55;

/** How many branches to offer before the list stops being a choice. */
const MAX_CANDIDATES = 25;

function roleColumn(role: PartyRole) {
  return (
    {
      consignee: 'is_consignee',
      shipper: 'is_shipper',
      agent: 'is_agent',
      transporter: 'is_transporter',
    } as const
  )[role];
}

/** Rough trigram similarity, mirroring pg_trgm closely enough to rank with. */
function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

/** Repository rows matching a free-text query, closest first. For the picker. */
export async function searchOrganizations(
  companyId: string,
  query: string,
  role?: PartyRole,
  limit = 20,
): Promise<OrganizationRow[]> {
  const db = serviceClient();
  const { data, error } = await db.rpc('search_organizations', {
    p_company: companyId,
    p_query: query,
    ...(role ? { p_role: role } : {}),
    p_limit: limit,
  });
  if (error) throw new Error(`Organization search failed: ${error.message}`);
  return (data ?? []) as OrganizationRow[];
}

/** One repository row by id, scoped to the company that owns it. */
export async function organizationById(
  companyId: string,
  id: string,
): Promise<OrganizationRow | null> {
  const db = serviceClient();
  const { data } = await db
    .from('organizations')
    .select('*')
    .eq('id', id)
    // The service role bypasses RLS, so this is the only thing stopping a
    // guessed uuid from crossing tenants.
    .eq('company_id', companyId)
    .maybeSingle();
  return data ?? null;
}

/**
 * The repository row for a name off a document.
 *
 * Exact on the normalised name first, because that is the answer whenever
 * there is one. Trigram only when there is not: it is what catches a name the
 * documents abbreviate, and it is also what could pick the wrong party, so it
 * has to clear a threshold and be alone in doing so.
 */
export async function resolveParty(
  companyId: string,
  role: PartyRole,
  name: string,
): Promise<PartyMatch> {
  const key = partyNameKey(name);
  if (!key) return { status: 'none' };

  const db = serviceClient();
  const flag = roleColumn(role);

  const { data: exact } = await db
    .from('organizations')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .eq(flag, true)
    .eq('name_key', key)
    .order('branch_name')
    .limit(MAX_CANDIDATES + 1);

  if (exact && exact.length === 1) return { status: 'exact', org: exact[0] as OrganizationRow };
  if (exact && exact.length > 1) {
    // SIEMENS LIMITED is 52 rows, one per branch, and they differ by the AD
    // code the Bill of Entry is filed against. Picking one here would be a
    // coin toss printed on a customs document.
    return { status: 'ambiguous', candidates: exact.slice(0, MAX_CANDIDATES) as OrganizationRow[] };
  }

  const near = await searchOrganizations(companyId, name, role, MAX_CANDIDATES);
  if (near.length === 0) return { status: 'none' };

  const scored = near
    .map((org) => ({ org, score: similarity(partyNameKey(org.name), key) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < FUZZY_MIN_SIMILARITY) {
    return { status: 'none', candidates: near.slice(0, MAX_CANDIDATES) };
  }

  // Several rows equally close means several branches of one party, or two
  // parties with near-identical names. Either way it is not ours to decide.
  const tied = scored.filter((s) => best.score - s.score < 0.001);
  if (tied.length > 1) {
    return { status: 'ambiguous', candidates: tied.map((s) => s.org).slice(0, MAX_CANDIDATES) };
  }

  return { status: 'fuzzy', org: best.org };
}

/** The address lines of a repository row, in the order Logi-Sys holds them. */
export function addressLinesOf(org: OrganizationRow): string[] {
  return [org.address1, org.address2, org.address3].filter(
    (line): line is string => typeof line === 'string' && line.trim() !== '',
  );
}

/** A draft's importer, rewritten from a repository row. */
export function importerFrom(
  org: OrganizationRow,
  status: PartyMatchStatus,
): ChecklistDraft['importer'] {
  return {
    name: org.name,
    addressLines: addressLinesOf(org),
    ...(org.iec ? { iec: org.iec } : {}),
    ...(org.pan ? { pan: org.pan } : {}),
    ...(org.gstin ? { gstin: org.gstin } : {}),
    ...(org.gst_state_code ? { gstStateCode: org.gst_state_code } : {}),
    ...(org.state ? { gstStateName: org.state } : {}),
    ...(org.ad_code ? { adCode: org.ad_code } : {}),
    ...(org.branch_sr_no ? { branchSno: org.branch_sr_no } : {}),
    // "0", "." and "NA" are how Logi-Sys spells "no branch", and the workbook
    // that imported cleanly left the column empty for exactly such a row.
    ...(branchNameForExport(org.branch_name)
      ? { branchName: branchNameForExport(org.branch_name) as string }
      : {}),
    ...(org.city ? { city: org.city } : {}),
    matchedFromMasters: true,
    organizationId: org.id,
    matchStatus: status,
  };
}

/** A draft's supplier, rewritten from a repository row. */
export function supplierFrom(
  org: OrganizationRow,
  status: PartyMatchStatus,
): ChecklistDraft['supplier'] {
  return {
    name: org.name,
    addressLines: addressLinesOf(org),
    ...(org.city ? { city: org.city } : {}),
    ...(org.state ? { state: org.state } : {}),
    ...(org.postal_code ? { postalCode: org.postal_code } : {}),
    ...(org.country ? { country: org.country } : {}),
    ...(branchNameForExport(org.branch_name)
      ? { branchName: branchNameForExport(org.branch_name) as string }
      : {}),
    ...(org.iec ? { iec: org.iec } : {}),
    ...(org.gstin ? { gstin: org.gstin } : {}),
    organizationId: org.id,
    matchStatus: status,
  };
}

/**
 * Bind a freshly built draft's parties to the repository.
 *
 * A party someone picked by hand is left alone: re-reading the documents must
 * not undo a correction, which is the whole reason the picker exists.
 */
export async function applyPartyResolution(
  draft: ChecklistDraft,
  companyId: string,
): Promise<ChecklistDraft> {
  const out: ChecklistDraft = { ...draft };
  let importerOrg: OrganizationRow | undefined;

  if (draft.importer.matchStatus !== 'manual' && draft.importer.name) {
    const match = await resolveParty(companyId, 'consignee', draft.importer.name);
    if (match.org) {
      importerOrg = match.org;
      out.importer = importerFrom(match.org, match.status);
    } else {
      out.importer = { ...draft.importer, matchStatus: match.status };
    }
  } else if (draft.importer.organizationId) {
    importerOrg = (await organizationById(companyId, draft.importer.organizationId)) ?? undefined;
  }

  if (draft.supplier.matchStatus !== 'manual' && draft.supplier.name) {
    const match = await resolveParty(companyId, 'shipper', draft.supplier.name);
    if (match.org) {
      out.supplier = supplierFrom(match.org, match.status);
    } else {
      out.supplier = { ...draft.supplier, matchStatus: match.status };
    }
  }

  out.flags = [
    ...draft.flags.filter((f) => f.path !== 'importer' && f.path !== 'supplier'),
    ...partyFlags(out),
  ];

  return applyImporterDefaults(out, importerOrg);
}

/**
 * The two things the CHA holds about an importer that Logi-Sys does not: the
 * marine open-policy rate and the default end-use code. They used to live on
 * the code-level importer master; they are columns on the organization now,
 * and they apply here because the merge that would otherwise want them runs
 * before the party is bound.
 */
function applyImporterDefaults(
  draft: ChecklistDraft,
  org: OrganizationRow | undefined,
): ChecklistDraft {
  if (!org) return draft;
  let out = draft;

  if (org.default_end_use_code) {
    out = {
      ...out,
      items: out.items.map((item) =>
        item.endUseCode === 'GNX100' ? { ...item, endUseCode: org.default_end_use_code as string } : item,
      ),
    };
  }

  const rate = org.marine_open_policy_rate_percent;
  const toi = out.invoice.termsOfInvoice;
  if (rate && !out.invoice.insurance && (toi === 'FOB' || toi === 'C&F')) {
    out = {
      ...out,
      invoice: { ...out.invoice, insurance: { kind: 'percent', percent: rate } },
      flags: [
        ...out.flags.filter((f) => f.path !== 'invoice.insurance'),
        {
          severity: 'info',
          path: 'invoice.insurance',
          message: `Insurance applied at ${rate}% of C&F per ${org.name}'s marine open policy — replace with the actual premium when available.`,
        },
      ],
    };
    // The duty block was computed on an invoice with no insurance in it.
    out = recomputeDuty(out);
  }

  return out;
}

function partyFlags(draft: ChecklistDraft): ChecklistDraft['flags'] {
  const flags: ChecklistDraft['flags'] = [];
  for (const [path, party] of [
    ['importer', draft.importer],
    ['supplier', draft.supplier],
  ] as const) {
    const what = path === 'importer' ? 'Importer' : 'Supplier';
    switch (party.matchStatus) {
      case 'none':
        flags.push({
          severity: 'warning',
          path,
          message: `${what} "${party.name}" is not in the organization repository. Logi-Sys keys its parties on this name, so pick the right one or add it in Logi-Sys and re-upload the repository.`,
        });
        break;
      case 'ambiguous':
        flags.push({
          severity: 'warning',
          path,
          message: `${what} "${party.name}" matches more than one branch in the organization repository — pick the branch this shipment is for.`,
        });
        break;
      case 'fuzzy':
        flags.push({
          severity: 'info',
          path,
          message: `${what} matched "${party.name}" in the organization repository by approximate name — confirm it is the right party.`,
        });
        break;
      default:
        break;
    }
  }
  return flags;
}
