import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Frank #7735: legacy /p/[key] redirect.
//
// Old share links of the shape
//   /p/uploads%2F2026-08-30%2F1788079037293-20251012_102253.jpg
// must continue to work after the photo-id URL migration (commit 2
// deleted the original /p/[key]/page.tsx and /api/photos/[key]/*).
//
// Flow:
//   1. URL-decode the [key] segment (%2F → /)
//   2. Look up photos.id by photos.key (admin client — bypasses RLS
//      because we don't know the viewer's permissions yet)
//   3. 301 redirect to /photos/{id}
//
// 404 if the key doesn't match any row. We deliberately do NOT 301
// to a "page-not-found" intermediate page — a direct 404 is honest
// about what happened.
//
// This route replaces app/p/[key]/page.tsx (deleted in commit 2)
// which used to render the photo directly. Now it just redirects.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  let decodedKey: string;
  try {
    decodedKey = decodeURIComponent(key);
  } catch {
    return NextResponse.json(
      { error: 'bad key encoding' },
      { status: 400 },
    );
  }

  if (!decodedKey) {
    return NextResponse.json(
      { error: 'missing key' },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: photo, error: photoError } = await supabase
    .from('photos')
    .select('id')
    .eq('key', decodedKey)
    .maybeSingle();

  if (photoError || !photo) {
    return NextResponse.json(
      { error: 'photo not found' },
      { status: 404 },
    );
  }

  return NextResponse.redirect(
    new URL(`/photos/${photo.id}`, req.url),
    301,
  );
}
