import { createSupabaseServerClient } from './supabase-server';

/**
 * Viewer role for §1 of 需求0827. Three tiers:
 *   - guest  : not authenticated. Sees only non-person photos (RLS
 *              enforces this at query time — anon key SELECTs
 *              automatically exclude photos with 'person' category).
 *   - user   : authenticated, app_metadata.role = 'user' or NULL
 *              (default). Sees all photos via RLS.
 *   - admin  : authenticated, app_metadata.role = 'admin'. Frank's
 *              account. Admin distinction is read from app_metadata;
 *              the /admin route gate is added in §2.
 *
 * Role-based access lives in two layers:
 *   1. Supabase RLS policy (database-level, primary)
 *   2. Application-level helpers (this file + Server Component checks)
 * RLS is the source of truth — these helpers exist for UI decisions
 * ("show login prompt" vs "show photo") and for Server Actions that
 * need to branch on viewer identity.
 */
export type ViewerRole = 'guest' | 'user' | 'admin';

export type Viewer = {
  role: ViewerRole;
  userId: string | null;
  email: string | null;
};

/**
 * Resolve the current viewer from the request's session cookies.
 * Returns guest on any error — fail closed. Never throws.
 *
 * Used in:
 *   - Server Components that need role-aware rendering
 *   - Server Actions that need role-aware writes
 *   - Route Handlers for API-level permission checks
 *
 * Reads app_metadata.role from Supabase Auth. Set Frank's role to
 * 'admin' in Supabase Auth dashboard (Auth → Users → Edit user →
 * app_metadata → {"role": "admin"}). Default role for all other
 * accounts is 'user'.
 */
export async function getViewer(): Promise<Viewer> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { role: 'guest', userId: null, email: null };
    }
    const roleMeta = data.user.app_metadata?.role;
    const role: ViewerRole = roleMeta === 'admin' ? 'admin' : 'user';
    return {
      role,
      userId: data.user.id,
      email: data.user.email ?? null,
    };
  } catch {
    return { role: 'guest', userId: null, email: null };
  }
}

/**
 * Can this viewer see this photo's full content (URLs, EXIF, GPS)?
 *
 * §4 of 需求0827: Guests can see scenery, not person. Person photos
 * require login. Authenticated users see all.
 *
 * Note: server-side enforcement via RLS is the primary mechanism.
 * This helper is for client-side rendering decisions — e.g. showing
 * a "login to view" placeholder when a guest navigates to a direct
 * URL of a person photo that was shared with them.
 */
export function canViewPhoto(
  viewer: Viewer,
  photo: { categories: string[] | null },
): boolean {
  if (viewer.role !== 'guest') return true;
  const cats = photo.categories ?? [];
  return !cats.includes('person');
}

/**
 * Is this viewer allowed to access admin-only routes (/admin, ...)?
 * Admin role only. Used by middleware / Server Components to gate
 * §2 of 需求0827.
 */
export function isAdmin(viewer: Viewer): boolean {
  return viewer.role === 'admin';
}