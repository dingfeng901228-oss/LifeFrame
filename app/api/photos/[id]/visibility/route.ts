import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Frank #7735: PATCH a single photo's §24 share level, keyed by UUID.
// Body: { visibility: 'private' | 'unlisted' | 'public' }
// Admin client used so we don't depend on anon write perms.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  let body: { visibility?: unknown };
  try {
    body = (await req.json()) as { visibility?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const visibility = body.visibility;
  if (
    visibility !== 'private' &&
    visibility !== 'unlisted' &&
    visibility !== 'public'
  ) {
    return NextResponse.json(
      {
        error:
          'invalid visibility — must be one of: private, unlisted, public',
      },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('photos')
    .update({ visibility })
    .eq('id', id)
    .select('id, visibility')
    .maybeSingle();

  if (error) {
    console.error('[visibility PATCH error]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'photo not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id, visibility: data.visibility });
}
