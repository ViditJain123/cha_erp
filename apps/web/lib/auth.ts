import 'server-only';
import { redirect } from 'next/navigation';
import { getAppClaims, type AppClaims } from '@checklist/db';
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

/** Us. Can create companies and reach the legacy tools. */
export async function requirePlatformAdmin(): Promise<AppClaims> {
  const claims = await requireUser();
  if (!claims.isPlatformAdmin) redirect('/');
  return claims;
}
