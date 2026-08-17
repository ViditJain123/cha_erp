import 'server-only';
import { redirect } from 'next/navigation';
import { getAppClaims, type AppClaims, type TeamKind } from '@checklist/db';
import { COMPANY_MANAGER_ROLES } from '@checklist/config/app';
import { supabaseServer } from './supabase/server';

/** Verified claims for the current request, or null when signed out. */
export async function currentClaims(): Promise<AppClaims | null> {
  const supabase = await supabaseServer();
  return getAppClaims(supabase);
}

/** Claims for a signed-in user; redirects to the login page otherwise. */
export async function requireUser(): Promise<AppClaims> {
  const claims = await currentClaims();
  if (!claims) redirect('/login');
  return claims;
}

export interface CompanyContext extends AppClaims {
  companyId: string;
}

/**
 * A signed-in user who belongs to a company and has finished onboarding.
 * Middleware normally catches these cases first; these checks are the
 * server-side backstop for direct route-handler hits.
 */
export async function requireCompany(): Promise<CompanyContext> {
  const claims = await requireUser();
  if (claims.mustChangePassword) redirect('/set-password');
  if (!claims.companyId) redirect(claims.isPlatformAdmin ? '/admin' : '/login');
  if (claims.status === 'disabled') redirect('/login?error=disabled');
  return claims as CompanyContext;
}

/** A company owner or admin — the roles allowed to invite and manage members. */
export async function requireCompanyManager(): Promise<CompanyContext> {
  const ctx = await requireCompany();
  if (!COMPANY_MANAGER_ROLES.includes(ctx.role)) redirect('/');
  return ctx;
}

/**
 * A member of one of the given teams.
 *
 * Managers pass regardless: an owner or admin has to be able to see and unstick
 * a queue they are not personally on. This is the first team gate in the app
 * outside mailbox connection, so it is deliberately narrow — it guards pages
 * built for one desk, not the shared job tabs.
 */
export async function requireTeam(...teams: TeamKind[]): Promise<CompanyContext> {
  const ctx = await requireCompany();
  if (COMPANY_MANAGER_ROLES.includes(ctx.role)) return ctx;
  if (!ctx.team || !teams.includes(ctx.team)) redirect('/');
  return ctx;
}

/** Us. Can create companies and reach the legacy tools. */
export async function requirePlatformAdmin(): Promise<AppClaims> {
  const claims = await requireUser();
  if (!claims.isPlatformAdmin) redirect('/');
  return claims;
}
