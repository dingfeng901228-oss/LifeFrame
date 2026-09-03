import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getViewer, canViewPhoto } from '@/lib/permissions';
import { getSignedR2DownloadUrl, type R2Config } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Frank #7735: auth-gated image proxy keyed by photo UUID. Same
// semantics as the legacy /api/photos/[key]/image route, but
// additionally enforces canViewPhoto so person photos cannot be
// bypassed via direct image URL even when visibility='public'.
// Old /api/photos/[key]/image only checked visibility; this new
// route closes that bypass by checking categories too.
//
// Auth matrix:
//   anon + scenery:    200
//   anon + person:     401 (canViewPhoto fail)
//   auth + private, not owner/admin: 403
//   auth + any other combination: 200
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return new Response('not found', { status: 404 });
  }

  const size = new URL(req.url).searchParams.get('w') === '256' ? '256' : 'full';

  // Admin client: we do the auth check ourselves below (canViewPhoto +
  // private-ownership), so RLS doesn't apply here.
  const supabaseAdmin = getSupabaseAdmin();
  const { data: photo, error: photoError } = await supabaseAdmin
    .from('photos')
    .select('id, key, visibility, user_id, thumbnail_key, categories')
    .eq('id', id)
    .maybeSingle();

  if (photoError || !photo) {
    return new Response('not found', { status: 404 });
  }

  const viewer = await getViewer();

  // Person photos: even 'public' visibility requires authentication.
  if (!canViewPhoto(viewer, photo)) {
    return new Response('unauthorized', { status: 401 });
  }

  // Private photos additionally require ownership or admin role.
  if (photo.visibility === 'private') {
    if (viewer.userId !== photo.user_id && viewer.role !== 'admin') {
      return new Response('forbidden', { status: 403 });
    }
  }

  // Resolve R2 key for this size. Thumbnail uses stored
  // thumbnail_key or falls back to the standard naming convention
  // used by app/api/process-thumbnail/route.ts.
  const r2Key =
    size === '256'
      ? photo.thumbnail_key || thumbnailFallbackKey(photo.key)
      : photo.key;

  const signedUrl = await getSignedR2DownloadUrl(config, r2Key, 600);

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
  headers.set('X-Robots-Tag', 'noindex, noimageindex');
  headers.set('Cache-Control', 'private, max-age=300');

  return new Response(r2Response.body, { status: 200, headers });
}

function thumbnailFallbackKey(originalKey: string): string {
  const ext = originalKey.match(/\.[^./]+$/)?.[0] ?? '';
  const base = ext ? originalKey.slice(0, -ext.length) : originalKey;
  return `${base}.256w.webp`;
}
