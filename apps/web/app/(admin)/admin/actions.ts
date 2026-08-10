'use server';

import { revalidatePath } from 'next/cache';
import { slugify } from '@checklist/db';
import { requirePlatformAdmin } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase/admin';
import { provisionUser, resetUserPassword } from '@/lib/provision';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Only populated when email went to the console transport, so it is readable in dev. */
  tempPassword?: string;
}

/** Finds a free slug, appending -2, -3 … when the obvious one is taken. */
async function uniqueSlug(base: string): Promise<string> {
  const db = serviceClient();
  const root = slugify(base) || 'company';
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const { data } = await db.from('companies').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
  }
  throw new Error('Could not derive a unique slug for that name.');
}

export async function createCompany(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const claims = await requirePlatformAdmin();

  const name = String(formData.get('name') ?? '').trim();
  const ownerEmail = String(formData.get('ownerEmail') ?? '').trim().toLowerCase();
  const ownerName = String(formData.get('ownerName') ?? '').trim();

  if (name.length < 2) return { error: 'Enter the company name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) return { error: 'Enter a valid owner email.' };

  const db = serviceClient();

  const slug = await uniqueSlug(name);
  const { data: company, error: companyError } = await db
    .from('companies')
    .insert({ name, slug, created_by: claims.userId })
    .select('id, name')
    .single();
  if (companyError || !company) {
    return { error: companyError?.message ?? 'Could not create the company.' };
  }

  try {
    const result = await provisionUser({
      email: ownerEmail,
      fullName: ownerName || null,
      companyId: company.id,
      companyName: company.name,
      role: 'company_owner',
      team: null,
      invitedBy: { id: claims.userId, name: 'the platform team' },
    });

    revalidatePath('/admin');
    return {
      ok: true,
      message:
        result.emailTransport === 'console'
          ? `${company.name} created. No Resend key is configured, so the credentials email was printed to the server console.`
          : `${company.name} created. Credentials emailed to ${ownerEmail}.`,
      ...(result.emailTransport === 'console' ? { tempPassword: result.tempPassword } : {}),
    };
  } catch (err) {
    // Roll the company back so the admin can simply try again.
    await db.from('companies').delete().eq('id', company.id);
    return { error: err instanceof Error ? err.message : 'Could not create the owner account.' };
  }
}

export async function resetPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  if (!userId) return { error: 'Missing user.' };

  try {
    const result = await resetUserPassword(userId);
    revalidatePath('/admin');
    return {
      ok: true,
      message:
        result.emailTransport === 'console'
          ? 'Password reset. The email was printed to the server console.'
          : 'Password reset and emailed.',
      ...(result.emailTransport === 'console' ? { tempPassword: result.tempPassword } : {}),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reset the password.' };
  }
}

export async function setUserStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePlatformAdmin();
  const userId = String(formData.get('userId') ?? '');
  const status = String(formData.get('status') ?? '');
  if (status !== 'active' && status !== 'disabled') return { error: 'Unknown status.' };

  const { error } = await serviceClient()
    .from('profiles')
    .update({ status })
    .eq('id', userId)
    .eq('is_platform_admin', false);
  if (error) return { error: error.message };

  revalidatePath('/admin');
  return {
    ok: true,
    message:
      status === 'disabled'
        ? 'User disabled. They are signed out on their next request.'
        : 'User re-enabled.',
  };
}
