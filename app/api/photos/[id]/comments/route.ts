import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CONTENT_LEN = 500;
const MIN_CONTENT_LEN = 1;

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

// Frank #7735: photo comments, keyed by photo UUID.
// GET: list comments (oldest first, capped 200).
// POST: create comment. Auth required. Length 1-500 + HTML escape.
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

  const { data, error } = await supabase
    .from('photo_comments')
    .select('id, content, created_at, user_id')
    .eq('photo_key', key)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(
  req: NextRequest,
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
      { error: 'unauthenticated — sign in to comment' },
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

  let body: { content?: unknown };
  try {
    body = (await req.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const raw = typeof body.content === 'string' ? body.content : '';
  const trimmed = raw.trim();
  if (trimmed.length < MIN_CONTENT_LEN) {
    return NextResponse.json({ error: '内容不能为空' }, { status: 400 });
  }
  if (trimmed.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: `内容最多 ${MAX_CONTENT_LEN} 字符` },
      { status: 400 },
    );
  }
  const safeContent = sanitizeContent(trimmed);

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
    if (error.code === '23514') {
      return NextResponse.json(
        { error: `内容最多 ${MAX_CONTENT_LEN} 字符` },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, comment: data });
}
