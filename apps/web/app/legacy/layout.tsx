import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Legacy checklist tools',
};

/**
 * The original single-tenant checklist generator, kept working but off the main
 * navigation. It still reads and writes the filesystem stores under
 * `apps/web/data/` — none of it is tenant-scoped, which is why access is
 * restricted to platform admins in middleware.
 */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-2 text-xs text-amber-900">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold uppercase tracking-wide">
            Legacy
          </span>
          <span>
            The original checklist generator. Single-tenant, file-backed, not part of the ERP.
          </span>
          <Link href="/" className="ml-auto font-medium underline hover:no-underline">
            Back to the ERP
          </Link>
        </div>
      </div>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/legacy" className="text-lg font-semibold tracking-tight">
            📋 Import Checklist <span className="text-indigo-600">AI</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            <Link href="/legacy" className="hover:text-slate-900">Jobs</Link>
            <Link href="/legacy/masters" className="hover:text-slate-900">Masters</Link>
            <Link href="/legacy/library" className="hover:text-slate-900">Library</Link>
            <Link
              href="/legacy/new"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700"
            >
              New Job
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
