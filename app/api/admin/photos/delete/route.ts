import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { deleteR2Objects, type R2Config } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same shape as the upload-url / process-thumbnail helpers — load R2
// config once per request, return a structured 503 if any of the four
// env vars is missing. Server-side env is set in Vercel + .env.local.
function loadConfig():
  | { ok: true; config: R2Config }
  | { ok: false; missing: string[] } {
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

/**
 * POST /api/admin/photos/delete
 * Body: { keys: string[] }
 *
 * §2.4 of 需求0827 — bulk delete with cascade. Order matters:
 *   1. Verify caller is admin (defense-in-depth — middleware already
 *      gates /admin/* but API routes aren't covered by that matcher).
 *   2. Fetch the rows so we know each photo's thumbnail_key (we need
 *      it to delete the thumbnail object too).
 *   3. Delete R2 originals + thumbnails first. If R2 delete fails we
 *      leave the DB row in place (orphan) so the admin can retry —
 *      better than a deleted row pointing at a still-existing R2
 *      object that other code might re-link.
 *   4. Delete the DB rows. ON DELETE CASCADE on PhotoLike /
 *      PhotoComment (when those tables exist) wipes the related
 *      rows automatically; no manual cleanup needed.
 *
 * Returns { ok: true, deleted: number } on success, or a structured
 * error with an HTTP code the client can switch on.
 */
export async function POST(req: NextRequest) {
  // Admin gate. Don't trust the page-level middleware — API routes
  // bypass it. session.user.app_metadata.role must be 'admin'.
  const supabaseServer = await createSupabaseServerClient();
  const { data: userData, error: userError } =
    await supabaseServer.auth.getUser();
  if (userError || !userData.user) {
    return Response.json(
      { error: 'unauthenticated' },
      { status: 401 },
    );
  }
  const role = (userData.user.app_metadata as { role?: string } | undefined)
    ?.role;
  if (role !== 'admin') {
    return Response.json(
      { error: 'forbidden — admin role required' },
      { status: 403 },
    );
  }

  // Parse body. Strict whitelist: array of strings under `keys`.
  let body: { keys?: unknown };
  try {
    body = (await req.json()) as { keys?: unknown };
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }
  const keys: string[] = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string')
    : [];
  if (keys.length === 0) {
    return Response.json(
      { error: 'no keys provided' },
      { status: 400 },
    );
  }
  // Defensive cap — admin shouldn't bulk-delete 10k photos in one
  // request. If Frank actually needs that, raise the cap.
  if (keys.length > 500) {
    return Response.json(
      { error: 'too many keys — cap is 500 per request' },
      { status: 400 },
    );
  }

  // 1. Fetch photo rows to learn the thumbnail keys.
  const supabase = getSupabaseAdmin();
  const { data: rows, error: fetchError } = await supabase
    .from('photos')
    .select('key, thumbnail_key')
    .in('key', keys);
  if (fetchError) {
    return Response.json(
      { error: `fetch failed: ${fetchError.message}` },
      { status: 500 },
    );
  }

  // 2. Collect every R2 object to delete (original + thumbnail).
  const r2Keys: string[] = [];
  for (const r of rows ?? []) {
    r2Keys.push(r.key);
    if (r.thumbnail_key) r2Keys.push(r.thumbnail_key);
  }

  // 3. Delete from R2. If R2 is misconfigured we still proceed to
  // the DB delete — R2 orphans are recoverable by re-uploading,
  // and not deleting the row would leave the user thinking the
  // delete succeeded when it actually didn't.
  const configResult = loadConfig();
  if (!configResult.ok) {
    console.error(
      '[admin/delete] R2 env not configured; only DB rows will be removed',
      configResult.missing,
    );
  } else if (r2Keys.length > 0) {
    try {
      await deleteR2Objects(configResult.config, r2Keys);
    } catch (err) {
      console.error('[admin/delete] R2 delete failed', err);
      return Response.json(
        {
          error: 'R2 delete failed',
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 502 },
      );
    }
  }

  // 4. Delete DB rows. PhotoLike / PhotoComment cascades (when
  // those tables land in §3 / §4) will run automatically.
  const { error: deleteError, count } = await supabase
    .from('photos')
    .delete({ count: 'exact' })
    .in('key', keys);
  if (deleteError) {
    return Response.json(
      { error: deleteError.message },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    deleted: count ?? keys.length,
    r2Deleted: r2Keys.length,
  });
}