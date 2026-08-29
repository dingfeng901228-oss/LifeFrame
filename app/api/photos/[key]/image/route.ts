import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import {
  getSignedR2DownloadUrl,
  type R2Config,
} from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function loadConfig(): { ok: true; config: R2Config } | { ok: false; missing: string[] } {
  const required = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
  } as const;

  const missing = Object.entries(required)
    .filter(([, v]) => !v || !String(v).trim())
    .map(([k]) => k);

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      accountId: required.R2_ACCOUNT_ID as string,
      accessKeyId: required.R2_ACCESS_KEY_ID as string,
      secretAccessKey: required.R2_SECRET_ACCESS_KEY as string,
      bucket: required.R2_BUCKET as string,
      publicBase: (process.env.R2_PUBLIC_BASE ?? '').replace(/\/$/, ''),
    },
  };
}

// Frank #7243 Task 2: auth-gated image proxy.
// Every photo <img src> now points here. The route enforces
// visibility / ownership rules that were previously bypassable
// by hitting R2 directly, and sets `X-Robots-Tag: noimageindex`
// so Google Images / Bing Images don't index the content
// (Task 3 second half).
//
// TTL is 600s (10 min) on the signed GET URL — long enough for
// our server-side stream fetch, short enough that a leaked URL
// stops working within the session.
//
// Auth matrix:
//   visibility='public'  → anon OK (server-side stream fetch)
//   visibility='unlisted'→ require any signed-in user (401 otherwise)
//   visibility='private' → require session AND (owner OR admin) (401/403)
//
// Recommended CF dashboard step (manual, out of band):
// disable public-read on the R2 bucket so the signed URL is
// meaningful. Until that's done, the proxy still gates access
// but a leaked R2 key would still fetch directly. The proxy +
// signature is layered; both layers matter.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const ready = loadConfig();
  if (!ready.ok) {
    return new Response(
      JSON.stringify({
        error: 'R2 env not configured',
        missing: ready.missing,
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const { config } = ready;

  const { key } = await params;
  const decodedKey = decodeURIComponent(key);
  const size = new URL(req.url).searchParams.get('w') === '256' ? '256' : 'full';

  if (!decodedKey) {
    return new Response('missing key', { status: 400 });
  }

  // Admin client so the auth check below is the only gate (not
  // RLS, which currently lets anon SELECT all rows). Pairs with
  // the explicit visibility checks below.
  const supabaseAdmin = getSupabaseAdmin();
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('photos')
    .select('key, visibility, user_id, thumbnail_key')
    .eq('key', decodedKey)
    .maybeSingle();

  if (photoError || !photo) {
    return new Response('not found', { status: 404 });
  }

  // Auth per visibility tier.
  if (photo.visibility !== 'public') {
    const supabaseServer = await createSupabaseServerClient();
    const { data: sessionData } = await supabaseServer.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
      // Frank #7243 Task 2 acceptance: "无痕窗口打开历史 /p/uploads/
      // ... 链接，返回 401/403/404". 401 for anon hitting a non-
      // public photo (the visibility check failed BEFORE we even
      // check ownership).
      return new Response('unauthorized', { status: 401 });
    }

    if (photo.visibility === 'private') {
      const role = (user.app_metadata as { role?: string } | undefined)
        ?.role;
      if (photo.user_id !== user.id && role !== 'admin') {
        // Frank #7243 Task 2 acceptance: "登录 A 用户不能访问登录 B
        // 用户的图片 URL". 403 for a wrong signed-in user (vs 401
        // for no user at all).
        return new Response('forbidden', { status: 403 });
      }
    }
    // 'unlisted': any signed-in user is allowed.
  }

  // Resolve the actual R2 key for this size. Thumbnail uses the
  // stored thumbnail_key (or falls back to the standard
  // ".256w.webp" naming convention used by process-thumbnail).
  const r2Key =
    size === '256'
      ? photo.thumbnail_key || thumbnailFallbackKey(decodedKey)
      : decodedKey;

  // Short-lived signed URL. Even with public-read on the bucket,
  // the proxy here is the only way to know which key maps to
  // which photo (no DB-backed CDN URL enumeration).
  const signedUrl = await getSignedR2DownloadUrl(config, r2Key, 600);

  // Server-side stream: lets us set X-Robots-Tag (noimageindex)
  // on the FINAL response. 302-redirecting to the signed URL
  // would be cheaper (Vercel bandwidth) but the redirect target
  // is R2 and we can't set headers there. For a personal photo
  // site with low traffic, the stream cost is negligible.
  const r2Response = await fetch(signedUrl);
  if (!r2Response.ok || !r2Response.body) {
    return new Response(
      JSON.stringify({
        error: 'upstream fetch failed',
        status: r2Response.status,
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const headers = new Headers();
  const contentType = r2Response.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  const contentLength = r2Response.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);
  // Frank #7243 Task 3: keep image content out of Google Images /
  // Bing Images. The accompanying robots.txt image-bot block (see
  // app/robots.ts) is belt-and-suspenders — this header is the
  // canonical signal when an image is fetched via this proxy.
  headers.set('X-Robots-Tag', 'noindex, noimageindex');
  // Private cache: visibility can change between requests, and
  // we don't want intermediate proxies caching an auth-gated
  // image for a different user. 5 min browser cache is enough
  // to dedupe rapid navigations.
  headers.set('Cache-Control', 'private, max-age=300');

  return new Response(r2Response.body, { status: 200, headers });
}

// Mirror the naming convention in app/api/process-thumbnail/route.ts:
// <original-without-ext>.256w.webp. Used as a fallback when
// thumbnail_key isn't stored (e.g., pre-thumbnail-feature rows).
function thumbnailFallbackKey(originalKey: string): string {
  const ext = originalKey.match(/\.[^./]+$/)?.[0] ?? '';
  const base = ext ? originalKey.slice(0, -ext.length) : originalKey;
  return `${base}.256w.webp`;
}
