import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = { title: 'Choose a password' };

export default async function SetPasswordPage() {
  const claims = await requireUser();

  return (
    <div>
      <h1 className="text-lg font-semibold">Choose a password</h1>
      <p className="mt-1 mb-5 text-sm text-slate-500">
        You are signed in with a temporary password. Pick your own to continue.
      </p>
      <SetPasswordForm email={claims.email} />
    </div>
  );
}
