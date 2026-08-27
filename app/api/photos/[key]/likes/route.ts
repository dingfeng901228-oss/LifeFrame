import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// §8 of 需求0827 — GET current like state for a photo.
// Returns { count: number, userLiked: boolean }.
//
// count = total likes on this photo (public engagement signal — visible
//   to anon too).
// userLiked = whether the requesting user has liked it (only set
//   when authenticated; false for guests).
//
// Guest viewers still get the count — they just see userLiked=false
// and the UI hides the like button behind a "登录后点赞" prompt
// per §8.1.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Total like count for this photo.
  const { count, error: countError } = await supabase
    .from('photo_likes')
    .select('*', { count: 'exact', head: true })
    .eq('photo_key', key);
  if (countError) {
    return Response.json({ error: countError.message }, { status: 500 });
  }

  // Did the current user like it? Resolve session once; guests
  // short-circuit to false. Frank #7117 #4: getUser() →
  // getSession() — same race-free pattern as the like POST
  // route above.
  let userLiked = false;
  try {
    const supabaseServer = await createSupabaseServerClient();
    const { data: sessionData } = await supabaseServer.auth.getSession();
    const sessionUser = sessionData.session?.user;
    if (sessionUser) {
      const { data: own } = await supabase
        .from('photo_likes')
        .select('id')
        .eq('photo_key', key)
        .eq('user_id', sessionUser.id)
        .maybeSingle();
      userLiked = Boolean(own);
    }
  } catch {
    // No session / env issue — treat as guest, userLiked=false.
  }

  return Response.json({ count: count ?? 0, userLiked });
}