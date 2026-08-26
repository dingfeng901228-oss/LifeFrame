import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware gate:
 * - /upload* requires an authenticated user; otherwise redirect to /login?next=…
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

  if (wantsUpload && !session) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', path);
    return NextResponse.redirect(redirect);
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
  matcher: ['/upload/:path*', '/login'],
};
