import { notFound, redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'LifeFrame Photo',
  description: 'A shared photo on LifeFrame.',
  // We override the layout's default noindex: this is the whole
  // point of /p/[key] — search engines can index public photos
  // for SEO traffic. unlisted photos are still in the sitemap? No —
  // only public is in the sitemap, but the page itself is still
  // indexable (the owner chose to make it public by definition;
  // unlisted photos 404 here, see the visibility check below).
  robots: { index: true, follow: true },
};

type PhotoRow = {
  key: string;
  public_url: string;
  thumbnail_url: string | null;
  filename: string;
  taken_at: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  visibility: 'private' | 'unlisted' | 'public';
  categories: string[] | null;
  camera_make: string | null;
  camera_model: string | null;
};

// /p/[key] — public photo view per §24. No auth required. Anon key
// is fine because we filter to visibility in ('public', 'unlisted')
// below and 'private' photos 404 — the existing RLS policy
// (using: true) lets anon SELECT, so the application layer is the
// only guard. That's acceptable for a single-user personal site; if
// Frank ever opens this up to many users, we'd want to tighten RLS
// to using (visibility <> 'private' or auth.uid() = user_id).
export default async function PublicPhotoPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    notFound();
  }

  const supabase = createClient(url, anonKey);
  const { data: photo } = await supabase
    .from('photos')
    .select(
      'key, public_url, thumbnail_url, filename, taken_at, location_name, lat, lng, visibility, categories, camera_make, camera_model',
    )
    .eq('key', key)
    .maybeSingle();

  // 404 for missing OR private. private photos are owner-only and
  // must not leak via direct URL.
  if (!photo || photo.visibility === 'private') {
    notFound();
  }

  // Frank #7203 #2: 'unlisted' is "不公开" — non-logged-in users
  // cannot see. Distinct from 'private' (owner-only): any signed-in
  // user can still open the direct URL, just not anonymous
  // visitors. Redirect guests to /login with a `next=` so they
  // bounce back to this same photo after signing in.
  //
  // We resolve the session via the cookie-bound server client (NOT
  // the anon client used for the photo fetch above) so the check
  // matches the same auth boundary as middleware + the like/comment
  // POST routes. getSession() reads the JWT locally — no network
  // round-trip, no race that turned previous getUser() attempts
  // into spurious nulls (Frank #7117 #4).
  if (photo.visibility === 'unlisted') {
    const supabaseServer = await createSupabaseServerClient();
    const { data: sessionData } = await supabaseServer.auth.getSession();
    if (!sessionData.session?.user) {
      redirect(
        `/login?next=${encodeURIComponent(`/p/${encodeURIComponent(key)}`)}`,
      );
    }
  }

  const takenAt = photo.taken_at
    ? new Date(photo.taken_at).toLocaleString('zh-CN')
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <article>
        <header className="mb-6">
          <Link
            href="/welcome"
            className="text-xs text-black/40 transition hover:text-black dark:text-white/40 dark:hover:text-white"
          >
            ← LifeFrame
          </Link>
          <h1 className="mt-4 text-2xl font-light text-black dark:text-white">{photo.filename}</h1>
          {takenAt && (
            <p className="mt-1 text-sm text-black/50 dark:text-white/50">📅 {takenAt}</p>
          )}
          {photo.location_name && (
            <p className="text-sm text-black/50 dark:text-white/50">📍 {photo.location_name}</p>
          )}
          {photo.visibility === 'unlisted' && (
            <p className="mt-2 text-xs text-amber-700/80 dark:text-amber-300/80">
              🔗 不列出的分享链接 — 不在搜索引擎中
            </p>
          )}
        </header>
        <div className="overflow-hidden rounded-lg bg-black/[0.02] dark:bg-white/[0.02]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.thumbnail_url || photo.public_url}
            alt={photo.filename}
            className="w-full object-contain"
          />
        </div>
        {photo.categories && photo.categories.length > 0 && (
          <p className="mt-4 text-sm text-black/60 dark:text-white/60">
            🏷️ {photo.categories.join(' · ')}
          </p>
        )}
        <footer className="mt-12 text-center">
          <Link
            href="/welcome"
            className="text-sm text-black/60 transition hover:text-black dark:text-white/60 dark:hover:text-white"
          >
            在 LifeFrame 上创建你自己的照片博物馆 →
          </Link>
        </footer>
      </article>
    </main>
  );
}