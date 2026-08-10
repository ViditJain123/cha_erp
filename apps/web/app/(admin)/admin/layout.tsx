import Link from 'next/link';
import { APP } from '@checklist/config/app';
import { requirePlatformAdmin } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const claims = await requirePlatformAdmin();

  return (
    <div>
      <header className="border-b border-slate-800 bg-slate-900 text-slate-100">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="text-sm font-semibold tracking-tight">
              {APP.name}
            </Link>
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              Platform
            </span>
          </div>
          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link href="/admin" className="hover:text-white">Companies</Link>
            <Link href="/legacy" className="hover:text-white">Legacy tools</Link>
            <span className="text-slate-500">{claims.email}</span>
            <form action="/api/auth/signout" method="post">
              <button type="submit" className="hover:text-white">Sign out</button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
