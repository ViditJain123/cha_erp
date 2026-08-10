import { createServerClient as createSsrServerClient, type CookieOptions } from '@supabase/ssr';
import { publicEnv } from '@checklist/config/env';
import type { Database } from './types.js';

export interface CookieRecord {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * The cookie plumbing the caller must supply. Kept as a parameter rather than
 * importing `next/headers` here so this package stays usable from the worker,
 * scripts and tests.
 */
export interface CookieAdapter {
  getAll(): CookieRecord[] | Promise<CookieRecord[]>;
  /** May be a no-op in contexts where response cookies cannot be set. */
  setAll(cookies: CookieRecord[]): void | Promise<void>;
}

/** Anon-key client bound to a request's cookies. Runs under RLS as the user. */
export function createServerClient(cookies: CookieAdapter) {
  const env = publicEnv();
  return createSsrServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookies.getAll() as CookieRecord[],
        setAll: (list) => cookies.setAll(list),
      },
    },
  );
}
