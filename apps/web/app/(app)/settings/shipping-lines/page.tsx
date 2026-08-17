import type { Metadata } from 'next';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { listShippingLines } from '../actions';
import { LineForm } from './line-form';
import { LineRow, type DepositRate } from './line-row';

export const metadata: Metadata = { title: 'Shipping lines' };
export const dynamic = 'force-dynamic';

export default async function ShippingLinesPage() {
  const { ctx, lines, rates } = await listShippingLines();
  const canManage = COMPANY_MANAGER_ROLES.includes(ctx.role);

  const ratesByLine = new Map<string, DepositRate[]>();
  for (const rate of rates) {
    const list = ratesByLine.get(rate.shipping_line_id) ?? [];
    list.push({
      id: rate.id,
      deliveryMode: rate.delivery_mode,
      containerSize: rate.container_size,
      amount: rate.amount,
    });
    ratesByLine.set(rate.shipping_line_id, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Shipping lines</h1>
        <p className="mt-1 text-sm text-slate-500">
          What a delivery order runs on: who to ask, how long the free detention period is, and what
          the container deposit costs. A job&rsquo;s DO tab prefills from here, and every value stays
          editable on the job.
        </p>
      </div>

      {canManage && <LineForm />}

      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No shipping lines yet. You can still fill a DO in by hand without one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Line</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">DO email</th>
                <th className="px-4 py-3">Issued via</th>
                <th className="px-4 py-3">Free days</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <LineRow
                  key={line.id}
                  lineId={line.id}
                  name={line.name}
                  agentName={line.agent_name}
                  doEmail={line.do_email}
                  issuesDoVia={line.issues_do_via}
                  defaultFreeDays={line.default_free_days}
                  aliases={line.aliases}
                  isActive={line.is_active}
                  canManage={canManage}
                  rates={ratesByLine.get(line.id) ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
