import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/photos/[key]/comments/[id] — §9.2 + §11 first-phase:
// owner can delete their own comment. Admin can delete any comment.
// service_role bypasses RLS so the admin path works without a
// separate policy; for the owner path the explicit check below
// matches the RLS policy ("user_id = auth.uid()") as defense-in-depth.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string; id: string }> },
) {
  const { key, id } = await params;
  if (!key || !id) {
    return Response.json({ error: 'missing key or id' }, { status: 400 });
  }

  const supabaseServer = await createSupabaseServerClient();
  // Frank #7129 Task #2 deep-dive (option b): getUser() →
  // getSession(). This DELETE handler was the missed third
  // instance of the same network-race pattern that
  // commit c8676ba / Frank #7117 #4 fixed for the like POST,
  // likes GET, and comments POST routes. getUser() makes a
  // network round-trip to Supabase to validate the JWT that
  // races intermittently — even when the session cookie is
  // valid, getUser() can return null for one render, which
  // 401s an admin deleting their own comment. getSession()
  // reads the JWT from cookies locally, no network call.
  const { data, error } = await supabaseServer.auth.getSession();
  if (error || !data.session?.user) {
    return Response.json(
      { error: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = data.session.user.id;
  const role = (data.session.user.app_metadata as { role?: string } | undefined)
    ?.role;

  const supabase = getSupabaseAdmin();

  // Fetch the comment to verify ownership before delete. RLS would
  // stop the delete on the owner path anyway, but service_role bypasses
  // RLS so we need this explicit check. Admin can delete any.
  const { data: comment, error: fetchError } = await supabase
    .from('photo_comments')
    .select('user_id, photo_key')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }
  if (!comment) {
    return Response.json(
      { error: 'comment not found' },
      { status: 404 },
    );
  }
  if (comment.photo_key !== key) {
    // Defensive: the comment id exists but belongs to a different
    // photo. Treat as not-found so we don't leak existence.
    return Response.json(
      { error: 'comment not found' },
      { status: 404 },
    );
  }
  const isOwner = comment.user_id === userId;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) {
    return Response.json(
      { error: 'forbidden — only owner or admin can delete' },
      { status: 403 },
    );
  }

  const { error: deleteError } = await supabase
    .from('photo_comments')
    .delete()
    .eq('id', id);
  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 });
  }
  return Response.json({ ok: true, deleted: id });
}