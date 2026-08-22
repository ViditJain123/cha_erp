import Link from 'next/link';
import { APP, TEAMS } from '@checklist/config/app';
import { requireCompany } from '@/lib/auth';
import { serviceForCompany } from '@/lib/supabase/admin';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/delivery-planning', label: 'Delivery planning' },
  { href: '/settings/mailbox', label: 'Mailbox' },
  { href: '/settings/team', label: 'Team' },
  { href: '/settings/branches', label: 'Branches' },
  { href: '/settings/ccr', label: 'Requirements' },
  { href: '/settings/organizations', label: 'Organizations' },
  { href: '/settings/shippers', label: 'Shippers' },
  { href: '/settings/shipping-lines', label: 'Shipping lines' },
  { href: '/settings/securities', label: 'Bonds & deposits' },
  { href: '/settings/cfs', label: 'CFS' },
  { href: '/settings/company', label: 'Company' },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCompany();
  const { data: company } = await serviceForCompany(ctx.companyId).company();

  return (
    <div className="flex min-h-screen">
      {/* Sticky rather than fixed: it stays a flex item, so the main column
          needs no matching left padding to sit beside it. */}
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto">
        <div className="flex h-14 items-center px-5 text-sm font-semibold tracking-tight">
          {APP.name}
        </div>
        <div className="border-y border-slate-100 px-5 py-3">
          <div className="truncate text-sm font-medium">{company?.name ?? '—'}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {ctx.team ? TEAMS[ctx.team].label : 'Administration'}
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 text-sm">
          <span className="text-slate-500">{ctx.email}</span>
          <form action="/api/auth/signout" method="post">
            <button type="submit" className="text-slate-600 hover:text-slate-900">
              Sign out
            </button>
          </form>
        </header>
        <main className="flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
