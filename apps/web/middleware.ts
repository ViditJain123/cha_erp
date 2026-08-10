import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient, redirectWithCookies } from '@/lib/supabase/middleware';

/** Reachable without a session. */
const PUBLIC_PATHS = ['/login', '/auth/callback'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { supabase, response } = createMiddlewareClient(request);

  // getUser() (not getSession()) is what validates the token and refreshes the
  // cookies. getSession() reads the cookie without verifying its signature and
  // must never back a trust decision.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const go = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = '';
    return redirectWithCookies(url, response);
  };

  if (!user) {
    if (isPublic(pathname)) return response;
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Bounce the user back to where they were aiming once they sign in.
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return redirectWithCookies(url, response);
  }

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? {}) as Record<string, unknown>;
  const companyId = typeof claims.company_id === 'string' ? claims.company_id : '';
  const isPlatformAdmin = claims.is_platform_admin === true;
  // Absent claim means the token hook did not run — fail closed.
  const mustChangePassword = claims.must_change_password !== false;
  const disabled = claims.user_status === 'disabled';

  if (disabled) {
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?error=disabled';
    return redirectWithCookies(url, response);
  }

  // A signed-in user has no business on the login page.
  if (pathname === '/login') {
    return go(mustChangePassword ? '/set-password' : isPlatformAdmin ? '/admin' : '/');
  }

  if (mustChangePassword) {
    return pathname === '/set-password' ? response : go('/set-password');
  }
  if (pathname === '/set-password') {
    return go(isPlatformAdmin ? '/admin' : '/');
  }

  // The legacy checklist generator and the platform console are ours alone.
  // Both the pages and their API routes must be gated — matching only pages
  // would leave /api/legacy/* wide open.
  const platformOnly =
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/legacy' ||
    pathname.startsWith('/legacy/') ||
    pathname.startsWith('/api/legacy/') ||
    pathname.startsWith('/api/admin/');
  if (platformOnly && !isPlatformAdmin) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'not found' }, { status: 404 })
      : go('/');
  }

  // Platform admins have no company, so the tenant app has nothing to show them.
  if (!companyId && !platformOnly) {
    return isPlatformAdmin ? go('/admin') : go('/login');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets. API routes are deliberately included so
     * their auth is enforced in one place.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
