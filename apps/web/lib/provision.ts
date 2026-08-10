import 'server-only';
import { generateTempPassword, type AppRole, type TeamKind } from '@checklist/db';
import { credentialsEmail, passwordResetEmail, sendEmail } from '@checklist/mail';
import { publicEnv } from '@checklist/config/env';
import { serviceClient } from './supabase/admin';

export interface ProvisionUserInput {
  email: string;
  fullName?: string | null;
  companyId: string;
  companyName: string;
  role: Exclude<AppRole, 'platform_admin'>;
  team?: TeamKind | null;
  invitedBy?: { id: string; name: string | null } | null;
}

export interface ProvisionUserResult {
  userId: string;
  /** Returned so the caller can surface it when the console mail transport is in use. */
  tempPassword: string;
  emailTransport: 'resend' | 'console';
}

function loginUrl(): string {
  return new URL('/login', publicEnv().NEXT_PUBLIC_APP_URL).toString();
}

/** Finds an existing auth user by email. The admin API has no direct lookup. */
async function findAuthUserId(email: string): Promise<string | undefined> {
  const db = serviceClient();
  const needle = email.trim().toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    if (data.users.length === 0) return undefined;
    const hit = data.users.find((u) => u.email?.toLowerCase() === needle);
    if (hit) return hit.id;
  }
  return undefined;
}

/**
 * Creates a user with a generated temporary password and emails them the
 * credentials. Used by both the platform admin (creating a company owner) and
 * company admins (inviting team members).
 *
 * There is no transaction spanning GoTrue and our tables, so a failure after
 * the auth user exists is compensated by deleting it. A half-created user can
 * never sign in *and* blocks re-invitation on the unique email — worse than
 * either outcome alone.
 */
export async function provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
  const db = serviceClient();
  const email = input.email.trim().toLowerCase();

  if (await findAuthUserId(email)) {
    throw new Error(`${email} already has an account.`);
  }

  const tempPassword = generateTempPassword();

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
  });
  if (createError || !created.user) {
    throw new Error(createError?.message ?? 'Could not create the account.');
  }
  const userId = created.user.id;

  try {
    const { error: profileError } = await db.from('profiles').insert({
      id: userId,
      email,
      full_name: input.fullName ?? null,
      company_id: input.companyId,
      role: input.role,
      team: input.team ?? null,
      is_platform_admin: false,
      must_change_password: true,
      status: 'invited',
      invited_by: input.invitedBy?.id ?? null,
    });
    if (profileError) throw new Error(profileError.message);

    const sent = await sendEmail(
      credentialsEmail({
        to: email,
        fullName: input.fullName ?? null,
        tempPassword,
        loginUrl: loginUrl(),
        companyName: input.companyName,
        team: input.team ?? null,
        invitedByName: input.invitedBy?.name ?? null,
      }),
    );

    return { userId, tempPassword, emailTransport: sent.transport };
  } catch (err) {
    await db.auth.admin.deleteUser(userId).catch(() => undefined);
    throw err;
  }
}

/** Resets a user's password to a fresh temporary one and emails it to them. */
export async function resetUserPassword(userId: string): Promise<ProvisionUserResult> {
  const db = serviceClient();

  const { data: profile, error: readError } = await db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', userId)
    .single();
  if (readError || !profile) throw new Error(readError?.message ?? 'No such user.');

  const tempPassword = generateTempPassword();

  const { error: authError } = await db.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (authError) throw new Error(authError.message);

  const { error: flagError } = await db
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', userId);
  if (flagError) throw new Error(flagError.message);

  const sent = await sendEmail(
    passwordResetEmail({
      to: profile.email,
      fullName: profile.full_name,
      tempPassword,
      loginUrl: loginUrl(),
    }),
  );

  return { userId, tempPassword, emailTransport: sent.transport };
}
