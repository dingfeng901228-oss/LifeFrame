import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/admin/photos/bulk-update
// Body: {
//   keys: string[],
//   updates: {
//     categories?: string[],
//     visibility?: 'private' | 'unlisted' | 'public',
//     location_name?: string | null,
//   }
// }
//
// Admin-only. Updates the listed photos with the given changes. All
// fields in `updates` are optional; at least one must be present.
// Server-side whitelisting: categories can only be 'person' / 'scenery',
// visibility only the three enum values. Silently drops anything else.
//
// §27 E.3 of 需求0827 — bulk edit location/categories. Works in
// tandem with §2.b bulk delete (same key list + admin gate pattern).

const VALID_VISIBILITY = ['private', 'unlisted', 'public'] as const;
const VALID_CATEGORIES = ['person', 'scenery'] as const;

export async function POST(req: NextRequest) {
  // Admin gate (defense-in-depth — middleware covers /admin/* pages
  // but API routes aren't covered).
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

  let body: { keys?: unknown; updates?: unknown };
  try {
    body = (await req.json()) as { keys?: unknown; updates?: unknown };
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  // Parse keys whitelist.
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string')
    : [];
  if (keys.length === 0) {
    return Response.json({ error: 'no keys provided' }, { status: 400 });
  }
  if (keys.length > 500) {
    return Response.json(
      { error: 'too many keys — cap is 500 per request' },
      { status: 400 },
    );
  }

  // Build the updates object with strict server-side whitelisting.
  const updates: Record<string, unknown> = {};
  if (body.updates && typeof body.updates === 'object') {
    const u = body.updates as {
      categories?: unknown;
      visibility?: unknown;
      location_name?: unknown;
      taken_at?: unknown;
      lat?: unknown;
      lng?: unknown;
    };

    if (Array.isArray(u.categories)) {
      const cats = u.categories
        .filter((x): x is string => typeof x === 'string')
        .filter((c): c is typeof VALID_CATEGORIES[number] =>
          (VALID_CATEGORIES as readonly string[]).includes(c),
        );
      // Dedupe just in case.
      updates.categories = Array.from(new Set(cats));
    }

    if (
      typeof u.visibility === 'string' &&
      (VALID_VISIBILITY as readonly string[]).includes(u.visibility)
    ) {
      updates.visibility = u.visibility;
    }

    if (typeof u.location_name === 'string') {
      const trimmed = u.location_name.trim().slice(0, 240);
      updates.location_name = trimmed.length > 0 ? trimmed : null;
    }

    // Frank #7117 #2: per-photo edit modal lets admin correct a
    // bad EXIF taken_at or pick a different capture date. Empty
    // string clears the field (null); non-empty strings must
    // parse to a Date. Anything unparseable is silently dropped
    // so a bad input doesn't 500 the whole batch (the route also
    // serves bulk-update, where one bad row shouldn't kill the
    // rest).
    if (typeof u.taken_at === 'string') {
      const trimmed = u.taken_at.trim();
      if (trimmed.length === 0) {
        updates.taken_at = null;
      } else {
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) {
          updates.taken_at = parsed.toISOString();
        }
      }
    }

    // Frank #7292: edit-modal MapPicker confirmation writes
    // lat/lng + location_name together. Coordinates are strictly
    // bounded (lat ∈ [-90,90], lng ∈ [-180,180]) so a typo can't
    // shove the marker to (0,0) or off the planet. Explicit null
    // is allowed to clear; anything else invalid is silently
    // dropped (matches the lenient pattern above).
    if (u.lat === null) {
      updates.lat = null;
    } else if (
      typeof u.lat === 'number' &&
      Number.isFinite(u.lat) &&
      u.lat >= -90 &&
      u.lat <= 90
    ) {
      updates.lat = u.lat;
    }
    if (u.lng === null) {
      updates.lng = null;
    } else if (
      typeof u.lng === 'number' &&
      Number.isFinite(u.lng) &&
      u.lng >= -180 &&
      u.lng <= 180
    ) {
      updates.lng = u.lng;
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { error: 'no valid updates provided' },
      { status: 400 },
    );
  }

  // Apply via service_role (RLS doesn't apply; admin role already
  // verified above).
  const supabase = getSupabaseAdmin();
  const { error: updateError, count } = await supabase
    .from('photos')
    .update(updates)
    .in('key', keys);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    updated: count ?? keys.length,
    applied: Object.keys(updates),
  });
}