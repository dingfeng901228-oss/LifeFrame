import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware gate:
 * - / requires an authenticated user; otherwise redirect to /login?next=…
 *   (per §24 of 要件定義書: "LifeFrame 默认是私人网站". Anyone visiting
 *   the site without a session sees the login page. The home page is the
 *   private dashboard; sharing photos publicly is Phase 2 scope.)
 * - /upload* requires an authenticated user; same redirect
 * - /login while already authenticated redirects home
 *
 * Uses getSession() (local JWT validation only) instead of getUser() (which
 * also fetches user data from Supabase). getSession() is enough for the
 * auth gate — we just need to know "is there a valid session cookie" — and
 * avoids a network call to Supabase on every navigation, which was failing
 * intermittently and producing a /upload → /login redirect loop even when
 * the user was clearly logged in client-side.
 *
 * Session is refreshed on every request so cookies stay fresh; that's what
 * the setAll callback is for.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Env not configured — let the request through; downstream code will
    // surface a clearer error than a 500 from middleware.
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = request.nextUrl.pathname;
  const wantsUpload = path.startsWith('/upload');
  const wantsLogin = path.startsWith('/login');
  const wantsAdmin = path.startsWith('/admin');

  // Frank #7108 #4: previously `!session && wantsHome` redirected
  // guests to /welcome so Google would crawl /, follow the redirect,
  // and index the marketing copy instead of seeing layout.tsx's
  // robots: { index: false } default. Frank wants guests to be
  // able to *browse the globe* at /, so we no longer gate / for
  // signed-out users. /welcome still exists as a marketing
  // landing page reachable via direct link / sitemap; the HomeGallery
  // component (RLS-filtered to public + non-person) handles the
  // guest-browse surface there.

  if (!session && wantsUpload) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', path);
    return NextResponse.redirect(redirect);
  }

  // §2 of 需求0827 — /admin/* is admin-only.
  // No session → /login. Session but not admin → / (don't 403 +
  // leak that the path is real; the admin shell's value comes from
  // not being discoverable to non-admins).
  if (wantsAdmin) {
    if (!session) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = '/login';
      redirect.searchParams.set('next', path);
      return NextResponse.redirect(redirect);
    }
    const role = (session.user?.app_metadata as { role?: string } | undefined)?.role;
    if (role !== 'admin') {
      const redirect = request.nextUrl.clone();
      redirect.pathname = '/';
      return NextResponse.redirect(redirect);
    }
  }

  if (wantsLogin && session) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ['/', '/upload/:path*', '/login', '/admin/:path*'],
};
