import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// §8 of 需求0827 — POST toggle like on a photo.
//
// Idempotent: if the user has already liked, POST deletes the row
// (unlike). If not, POST inserts the row. Concurrent inserts from
// two browser tabs collide on the (user_id, photo_key) unique
// constraint; we treat the 23505 duplicate-key error as success
// so the final state is still "liked".
//
// 401 for unauthenticated (spec §8.1: 游客不能点赞).
// 404 for missing photo.
// 500 for any other Supabase error.
//
// Returns { liked: bool, count: number } so the client can update
// the heart icon + count without a second GET.

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  // Caller must be signed in.
  const supabaseServer = await createSupabaseServerClient();
  const { data: userData, error: userError } =
    await supabaseServer.auth.getUser();
  if (userError || !userData.user) {
    return Response.json(
      { error: 'unauthenticated — sign in to like' },
      { status: 401 },
    );
  }
  const userId = userData.user.id;

  const supabase = getSupabaseAdmin();

  // Verify the photo exists. 404 before any insert/delete so the
  // count read at the end is meaningful.
  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('key')
    .eq('key', key)
    .maybeSingle();
  if (photoError) {
    return Response.json({ error: photoError.message }, { status: 500 });
  }
  if (!photo) {
    return Response.json({ error: 'photo not found' }, { status: 404 });
  }

  // Look up the user's existing like.
  const { data: existing, error: existingError } = await supabase
    .from('photo_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('photo_key', key)
    .maybeSingle();
  if (existingError) {
    return Response.json(
      { error: existingError.message },
      { status: 500 },
    );
  }

  if (existing) {
    // Unlike.
    const { error: deleteError } = await supabase
      .from('photo_likes')
      .delete()
      .eq('id', existing.id);
    if (deleteError) {
      return Response.json(
        { error: deleteError.message },
        { status: 500 },
      );
    }
  } else {
    // Like. Use service_role to bypass RLS — we already verified the
    // caller is authenticated and the photo exists above. Catch the
    // unique-constraint violation (race with another tab) and treat
    // as success so the endpoint stays idempotent.
    const { error: insertError } = await supabase
      .from('photo_likes')
      .insert({ user_id: userId, photo_key: key });
    if (insertError) {
      const isDup =
        insertError.code === '23505' ||
        insertError.message.toLowerCase().includes('duplicate');
      if (!isDup) {
        return Response.json(
          { error: insertError.message },
          { status: 500 },
        );
      }
    }
  }

  // Recount for the response so the client doesn't need a second GET.
  const { count } = await supabase
    .from('photo_likes')
    .select('*', { count: 'exact', head: true })
    .eq('photo_key', key);

  return Response.json({
    liked: !existing,
    count: count ?? 0,
  });
}