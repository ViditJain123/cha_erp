import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const notice =
    params.error === 'disabled'
      ? 'That account has been disabled. Contact your administrator.'
      : null;

  return (
    <div>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-slate-500">
        Accounts are created by an administrator. Use the credentials you were emailed.
      </p>
      {notice && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {notice}
        </div>
      )}
      <LoginForm next={params.next ?? null} />
    </div>
  );
}
