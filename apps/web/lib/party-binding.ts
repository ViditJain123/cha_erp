// Not `server-only`, for the same reason lib/do.ts and lib/clearance.ts are
// not: turning a repository row into a draft party is a pure rewrite with no
// query and no secret in it, and it is the half of party binding most worth
// testing on its own — see test/party-binding.test.ts for why.
//
// Relative imports, not the `@/` alias: vitest resolves only real paths.
import type { PartyCandidate, PartyMatchStatus, ChecklistDraft } from '@checklist/extraction';
import type { Database } from '@checklist/db';
import { branchNameForExport } from '@checklist/core';

export type OrganizationRow = Database['public']['Tables']['organizations']['Row'];

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

/** A repository row as the branch picker on the job screen has to show it. */
export function candidateOf(org: OrganizationRow): PartyCandidate {
  return {
    id: org.id,
    name: org.name,
    // The raw branch, not `branchNameForExport` — '0' is a placeholder to the
    // workbook but it is how a person tells this row from the next one.
    branchName: org.branch_name,
    ...(org.city ? { city: org.city } : {}),
    ...(org.ad_code ? { adCode: org.ad_code } : {}),
    ...(org.iec ? { iec: org.iec } : {}),
  };
}
