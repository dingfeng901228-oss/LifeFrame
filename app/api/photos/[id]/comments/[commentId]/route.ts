import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Frank #7735: DELETE a comment, keyed by photo UUID.
// 401 for unauthenticated, 403 if not the comment owner (admin can
// delete any), 404 if comment doesn't exist on this photo.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id, commentId } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const supabaseServer = await createSupabaseServerClient();
  const { data: sessionData, error: sessionError } =
    await supabaseServer.auth.getSession();
  if (sessionError || !sessionData.session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated — sign in to delete comment' },
      { status: 401 },
    );
  }
  const userId = sessionData.session.user.id;
  const role = (
    sessionData.session.user.app_metadata as { role?: string } | undefined
  )?.role;

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

  const { data: comment } = await supabase
    .from('photo_comments')
    .select('id, user_id')
    .eq('id', commentId)
    .eq('photo_key', key)
    .maybeSingle();
  if (!comment) {
    return NextResponse.json({ error: 'comment not found' }, { status: 404 });
  }
  if (comment.user_id !== userId && role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { error } = await supabase
    .from('photo_comments')
    .delete()
    .eq('id', commentId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
