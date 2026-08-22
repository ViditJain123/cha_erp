import { NextResponse } from 'next/server';
import { requireCompany } from '@/lib/auth';
import { searchOrganizations, type PartyRole } from '@/lib/parties';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ROLES: PartyRole[] = ['consignee', 'shipper', 'agent', 'transporter'];

/**
 * Repository rows for the party picker on a job.
 *
 * Fetched from the browser rather than rendered server-side because the
 * operator types until they recognise the branch they want, and five thousand
 * organizations is not a list you ship to a page.
 */
export async function GET(request: Request) {
  const ctx = await requireCompany();
  const url = new URL(request.url);

  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const roleParam = url.searchParams.get('role');
  const role = ROLES.find((r) => r === roleParam);

  const rows = await searchOrganizations(ctx.companyId, query, role, 20);

  return NextResponse.json({
    results: rows.map((org) => ({
      id: org.id,
      name: org.name,
      branchName: org.branch_name,
      branchSrNo: org.branch_sr_no,
      city: org.city,
      country: org.country,
      iec: org.iec,
      gstin: org.gstin,
      adCode: org.ad_code,
    })),
  });
}
