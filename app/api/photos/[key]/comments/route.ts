import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// §9 of 需求0827 — photo comments.
//   GET  — list comments for a photo (public, oldest first, capped 200).
//   POST — create a comment. Auth required. §12 length 1-500 + HTML
//          escape applied here so what we store is already safe to
//          dangerouslySetInnerHTML on the client.

const MAX_CONTENT_LEN = 500;
const MIN_CONTENT_LEN = 1;

/**
 * §12 defense-in-depth: HTML-escape the four characters that can
 * break out of a `<p>` or attribute context. Stored content is then
 * safe to render with dangerouslySetInnerHTML on the client without
 * needing DOMPurify. The Postgres CHECK constraint is the final
 * line (length) but doesn't help with XSS.
 */
function sanitizeContent(raw: string): string {
  return raw
    .replace(/[&<>"']/g, (c) =>
      c === '&'
        ? '&amp;'
        : c === '<'
          ? '&lt;'
          : c === '>'
            ? '&gt;'
            : c === '"'
              ? '&quot;'
              : '&#39;',
    )
    .slice(0, MAX_CONTENT_LEN);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('photo_comments')
    .select('id, content, created_at, user_id')
    .eq('photo_key', key)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ comments: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  // Auth gate. §9.1: 游客不能评论.
  const supabaseServer = await createSupabaseServerClient();
  const { data: userData, error: userError } =
    await supabaseServer.auth.getUser();
  if (userError || !userData.user) {
    return Response.json(
      { error: 'unauthenticated — sign in to comment' },
      { status: 401 },
    );
  }
  const userId = userData.user.id;

  // Parse + validate body.
  let body: { content?: unknown };
  try {
    body = (await req.json()) as { content?: unknown };
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }
  const raw = typeof body.content === 'string' ? body.content : '';
  const trimmed = raw.trim();
  if (trimmed.length < MIN_CONTENT_LEN) {
    return Response.json(
      { error: '内容不能为空' },
      { status: 400 },
    );
  }
  if (trimmed.length > MAX_CONTENT_LEN) {
    return Response.json(
      { error: `内容最多 ${MAX_CONTENT_LEN} 字符` },
      { status: 400 },
    );
  }
  const safeContent = sanitizeContent(trimmed);

  // Insert via service_role so we don't fight RLS — we've already
  // verified auth + ownership above. ON DELETE CASCADE on photo_key
  // / user_id is set up in infra/007.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('photo_comments')
    .insert({
      user_id: userId,
      photo_key: key,
      content: safeContent,
    })
    .select('id, content, created_at, user_id')
    .single();
  if (error) {
    // The CHECK constraint can throw a 23514 (check_violation) if
    // HTML escaping somehow produced an over-length string. Map that
    // to a clean 400 instead of 500.
    if (error.code === '23514') {
      return Response.json(
        { error: `内容最多 ${MAX_CONTENT_LEN} 字符` },
        { status: 400 },
      );
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true, comment: data });
}