'use server';

import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/admin';
import { validatePassword } from '@/lib/password';

export interface AuthActionState {
  error?: string;
}

/** Where a freshly signed-in user belongs, read from their profile row. */
async function destinationFor(userId: string, next: string): Promise<string> {
  const { data: profile } = await serviceClient()
    .from('profiles')
    .select('is_platform_admin, must_change_password')
    .eq('id', userId)
    .maybeSingle();

  if (!profile || profile.must_change_password) return '/set-password';
  if (profile.is_platform_admin) return '/admin';
  // Guard against open redirects: only same-origin absolute paths.
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/**
 * Sign-in runs server-side rather than in the browser so the form works before
 * (or without) hydration: the server client writes the session cookies itself.
 * A client-only handler leaves a window where clicking Submit does a native
 * POST that quietly does nothing.
 */
export async function signIn(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // Deliberately vague: distinguishing "no such user" from "wrong password"
    // turns the login form into an account-enumeration oracle.
    return { error: 'That email and password combination is not recognised.' };
  }

  // Resolve the destination here rather than bouncing off middleware, so the
  // address bar matches the page that renders.
  redirect(await destinationFor(data.user.id, String(formData.get('next') ?? '')));
}

/** Sets the user's own password and clears the forced-change flag. */
export async function setPassword(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const claims = await requireUser();

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  const invalid = validatePassword(password, claims.email);
  if (invalid) return { error: invalid };

  const db = serviceClient();

  // Both writes happen here so they cannot drift: a password changed with the
  // flag left set would trap the user in a redirect loop on this page.
  const { error: authError } = await db.auth.admin.updateUserById(claims.userId, { password });
  if (authError) return { error: authError.message };

  const { error: profileError } = await db
    .from('profiles')
    .update({ must_change_password: false, status: 'active' })
    .eq('id', claims.userId);
  if (profileError) return { error: profileError.message };

  // must_change_password is a JWT claim, so the token must be reissued before
  // middleware will let the user off this page. Signing in again with the new
  // password is what does that: an admin password change invalidates the
  // existing refresh token, so refreshSession() here would fail.
  const supabase = await supabaseServer();
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: claims.email,
    password,
  });

  redirect(signInError || !data.user ? '/login' : claims.isPlatformAdmin ? '/admin' : '/');
}
