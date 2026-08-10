import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseEnv } from '@checklist/config/env';
import type { Database } from './types.js';

/**
 * Service-role client. It has the `bypassrls` attribute, so **no policy
 * protects anything reached through here** — every query must scope company_id
 * by hand. Server and worker only; importing this into a client component would
 * ship the key to browsers.
 *
 * Prefer `serviceForCompany()` below over the raw client wherever the work is
 * tenant-scoped: it injects company_id so it cannot be forgotten.
 */
let cached: SupabaseClient<Database> | undefined;

export function serviceClient(): SupabaseClient<Database> {
  if (typeof window !== 'undefined') {
    throw new Error('serviceClient() was called in the browser — this leaks the service-role key.');
  }
  if (!cached) {
    const env = supabaseEnv();
    cached = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return cached;
}

/**
 * A service-role handle pinned to one tenant. Every read filters on company_id
 * and every write stamps it, so the caller cannot accidentally address another
 * company's rows.
 */
export function serviceForCompany(companyId: string) {
  const db = serviceClient();
  return {
    companyId,
    /** The company row itself. */
    company: () => db.from('companies').select('*').eq('id', companyId).single(),
    /** Members of this company, newest first. */
    profiles: () =>
      db
        .from('profiles')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
    /** One member, or null if they belong to a different company. */
    profile: (userId: string) =>
      db.from('profiles').select('*').eq('company_id', companyId).eq('id', userId).maybeSingle(),
  };
}
