import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@checklist/db/server';

/**
 * Request-scoped Supabase client for server components, route handlers and
 * server actions. Runs as the signed-in user, under RLS.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient({
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (list) => {
      try {
        for (const { name, value, options } of list) store.set(name, value, options);
      } catch {
        // Server Components cannot set cookies. Middleware has already
        // refreshed the session, so this is expected and safe to swallow.
      }
    },
  });
}
