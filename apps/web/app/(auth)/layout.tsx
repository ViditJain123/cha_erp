import { APP } from '@checklist/config/app';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-xl font-semibold tracking-tight">{APP.name}</div>
          <div className="mt-1 text-sm text-slate-500">{APP.tagline}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
