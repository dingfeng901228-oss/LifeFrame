import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Server-side Supabase client using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
 * Use ONLY in server contexts (Next.js API routes, server components).
 * For browser-side queries, create a separate anon-key client.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env not configured: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required',
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type PhotoRow = {
  id: string;
  created_at: string;
  key: string;
  public_url: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  camera_make: string | null;
  camera_model: string | null;
  // §24 share level. New photos default to 'private' (column default).
  // 'unlisted' is reachable by direct URL but excluded from sitemap.
  // 'public' is reachable by URL AND emitted into sitemap so search
  // engines can index the /p/[key] page.
  visibility: 'private' | 'unlisted' | 'public';
  // §1 of 需求0827: uploader (FK auth.users). NULL for legacy rows
  // before the migration; new uploads always set this from session.
  user_id: string | null;
};

export type PhotoInsert = {
  key: string;
  public_url: string;
  filename: string;
  content_type?: string | null;
  size_bytes?: number | null;
  taken_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  camera_make?: string | null;
  camera_model?: string | null;
  visibility?: 'private' | 'unlisted' | 'public';
  user_id?: string | null;
};