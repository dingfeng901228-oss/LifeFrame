import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Frank #7735: GET current like state, keyed by photo UUID.
// Returns { count, userLiked }. count is public; userLiked is only
// true when the requesting user has liked it (false for guests).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

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

  const { count, error: countError } = await supabase
    .from('photo_likes')
    .select('*', { count: 'exact', head: true })
    .eq('photo_key', key);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

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

  return NextResponse.json({ count: count ?? 0, userLiked });
}
