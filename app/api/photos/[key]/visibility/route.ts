import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH /api/photos/[key]/visibility
// Body: { visibility: 'private' | 'unlisted' | 'public' }
// Updates a single photo's §24 share level. Uses the service_role
// admin client so we don't depend on the anon key having write
// permissions — a single-user personal site doesn't need per-row
// owner scoping at the RLS layer for now.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  if (!key) {
    return Response.json({ error: 'missing key' }, { status: 400 });
  }

  let body: { visibility?: unknown };
  try {
    body = (await req.json()) as { visibility?: unknown };
  } catch {
    return Response.json({ error: 'invalid json body' }, { status: 400 });
  }

  const visibility = body.visibility;
  if (
    visibility !== 'private' &&
    visibility !== 'unlisted' &&
    visibility !== 'public'
  ) {
    return Response.json(
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
    .eq('key', key)
    .select('key, visibility')
    .maybeSingle();

  if (error) {
    console.error('[visibility PATCH error]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: 'photo not found' }, { status: 404 });
  }

  return Response.json({ ok: true, key: data.key, visibility: data.visibility });
}