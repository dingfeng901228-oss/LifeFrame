import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Frank #7735: POST toggle like, keyed by photo UUID.
// Idempotent — if already liked, unlikes; if not, likes. Concurrent
// inserts race on the (user_id, photo_key) unique constraint; we
// treat the 23505 duplicate as success.
//
// Internally we look up the photo's key by id once, then operate on
// photo_likes.photo_key (the like table's natural key) — keeps the
// DB schema stable while the public URL moves to UUID.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const supabaseServer = await createSupabaseServerClient();
  const { data: sessionData, error: sessionError } =
    await supabaseServer.auth.getSession();
  if (sessionError || !sessionData.session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated — sign in to like' },
      { status: 401 },
    );
  }
  const userId = sessionData.session.user.id;

  const supabase = getSupabaseAdmin();

  const { data: photo } = await supabase
    .from('photos')
    .select('key')
    .eq('id', id)
    .maybeSingle();
  if (!photo) {
    return NextResponse.json({ error: 'photo not found' }, { status: 404 });
  }
  const key = photo.key;

  const { data: existing } = await supabase
    .from('photo_likes')
    .select('id')
    .eq('user_id', userId)
    .eq('photo_key', key)
    .maybeSingle();

  if (existing) {
    const { error: deleteError } = await supabase
      .from('photo_likes')
      .delete()
      .eq('id', existing.id);
    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 },
      );
    }
  } else {
    const { error: insertError } = await supabase
      .from('photo_likes')
      .insert({ user_id: userId, photo_key: key });
    if (insertError) {
      const isDup =
        insertError.code === '23505' ||
        insertError.message.toLowerCase().includes('duplicate');
      if (!isDup) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 },
        );
      }
    }
  }

  const { count } = await supabase
    .from('photo_likes')
    .select('*', { count: 'exact', head: true })
    .eq('photo_key', key);

  return NextResponse.json({ liked: !existing, count: count ?? 0 });
}
