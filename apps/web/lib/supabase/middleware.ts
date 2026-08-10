import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@checklist/db/server';

/**
 * Builds a Supabase client bound to the middleware request/response pair.
 *
 * The returned `response` accumulates refreshed auth cookies. Every branch of
 * middleware — including redirects — must return a response carrying those
 * cookies, or the session silently drops on the next navigation. Use
 * `redirectWithCookies()` rather than a bare NextResponse.redirect().
 */
export function createMiddlewareClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient({
    getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (list) => {
      for (const { name, value } of list) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of list) response.cookies.set(name, value, options);
    },
  });

  return {
    supabase,
    get response() {
      return response;
    },
  };
}

/** A redirect that preserves the refreshed auth cookies. */
export function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
