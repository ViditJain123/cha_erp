'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Scrutiny and DO run side by side, so they are tabs rather than stages of one
 * page. Nested routes rather than a `?tab=` param: the DO tab then never pays
 * for the CCR and shipper read models the scrutiny page runs on every render.
 */
export function JobTabs({
  jobId,
  doAlertLevel,
  clearanceAlertLevel,
}: {
  jobId: string;
  doAlertLevel: string | null;
  clearanceAlertLevel: string | null;
}) {
  const pathname = usePathname();
  const tabs = [
    { href: `/jobs/${jobId}`, label: 'Scrutiny', alert: null as string | null },
    { href: `/jobs/${jobId}/do`, label: 'Delivery order', alert: doAlertLevel },
    { href: `/jobs/${jobId}/clearance`, label: 'Clearance', alert: clearanceAlertLevel },
  ];

  return (
    <nav className="mt-5 flex gap-1 border-b border-slate-200">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {tab.label}
            {tab.alert && (
              <span
                aria-label={tab.alert === 'overdue' ? 'Overdue' : 'Due soon'}
                className={`h-1.5 w-1.5 rounded-full ${
                  tab.alert === 'overdue' ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
