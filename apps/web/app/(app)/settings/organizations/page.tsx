import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listOrganizations } from '../actions';
import { OrgRow } from './org-row';
import { UploadForm } from './upload-form';

export const metadata: Metadata = { title: 'Organizations' };
export const dynamic = 'force-dynamic';

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? '').slice(0, 120);
  const { ctx, organizations, activeCount, lastImport, pageSize } = await listOrganizations(query);
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every importer, shipper, agent and transporter, exactly as Logi-Sys spells them. Logi-Sys
          resolves a party on the name and branch in the workbook we send it, so this is where those
          strings come from &mdash; not from whatever the bill of lading happened to print.
        </p>
      </div>

      {canManage && <UploadForm />}

      {lastImport && (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="font-medium">{activeCount.toLocaleString()} active organizations</span>
            <span className="text-slate-500">
              Last upload {new Date(lastImport.created_at).toLocaleString()} &mdash;{' '}
              {lastImport.file_name}
            </span>
            <span className="text-slate-500">
              {lastImport.inserted_count.toLocaleString()} added,{' '}
              {lastImport.updated_count.toLocaleString()} updated,{' '}
              {lastImport.retired_count.toLocaleString()} retired
            </span>
          </div>
          {lastImport.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-700">
              {lastImport.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* A plain GET form: five thousand parties is not a list you scroll, and
          the app has no client-side table to filter. */}
      <form className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name — SIEMENS, ELITE POLYPLUS…"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Search
        </button>
      </form>

      {organizations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {activeCount === 0
            ? 'No organizations yet. Export the Organization Repository out of Logi-Sys and upload it above.'
            : `Nothing matches “${query}”.`}
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Organization</th>
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Acts as</th>
                  <th className="px-4 py-3">IEC</th>
                  <th className="px-4 py-3">GSTIN</th>
                  <th className="px-4 py-3">AD code</th>
                  <th className="px-4 py-3 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organizations.map((org) => (
                  <OrgRow
                    key={org.id}
                    orgId={org.id}
                    name={org.name}
                    branchName={org.branch_name}
                    branchSrNo={org.branch_sr_no}
                    city={org.city}
                    country={org.country}
                    adCode={org.ad_code}
                    iec={org.iec}
                    gstin={org.gstin}
                    isConsignee={org.is_consignee}
                    isShipper={org.is_shipper}
                    isAgent={org.is_agent}
                    isTransporter={org.is_transporter}
                    defaultEndUseCode={org.default_end_use_code}
                    marineOpenPolicyRatePercent={org.marine_open_policy_rate_percent}
                    marinePolicyNo={org.marine_policy_no}
                    marinePolicySumInsuredInr={org.marine_policy_sum_insured_inr}
                    marinePolicyPerSendingLimitInr={org.marine_policy_per_sending_limit_inr}
                    marinePolicyValidTill={org.marine_policy_valid_till}
                    canManage={canManage}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {organizations.length === pageSize && (
            <p className="text-xs text-slate-500">
              Showing the {pageSize} closest matches. Narrow the search to see the
              rest.
            </p>
          )}
        </>
      )}
    </div>
  );
}
