import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getViewer, canViewPhoto } from '@/lib/permissions';
import { photoImageUrl } from '@/lib/photo-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'LifeFrame Photo',
  description: 'A shared photo on LifeFrame.',
  // /photos/[id] is the share target for §24 (visibility). Search
  // engines can index public photos for SEO traffic. Unlisted photos
  // are still reachable by direct URL but not in the sitemap.
  robots: { index: true, follow: true },
};

type PhotoRow = {
  id: string;
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
  user_id: string | null;
  camera_make: string | null;
  camera_model: string | null;
};

// Frank #7735: UUID validator — reject anything that isn't a real
// UUID before hitting the DB. Saves a round-trip and gives clearer
// 404s for malformed share-link copies.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PhotoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const supabaseServer = await createSupabaseServerClient();
  const { data: photo } = await supabaseServer
    .from('photos')
    .select(
      'id, key, user_id, public_url, thumbnail_url, filename, taken_at, location_name, lat, lng, visibility, categories, camera_make, camera_model',
    )
    .eq('id', id)
    .maybeSingle();

  if (!photo) {
    notFound();
  }

  const viewer = await getViewer();

  // Frank #7735: person photos cannot be viewed by guests even if
  // the URL is shared. canViewPhoto returns false for anon + 'person'
  // in categories — show a login prompt instead of 404 so the photo's
  // existence is not silently hidden from someone who already has the
  // direct link.
  if (!canViewPhoto(viewer, photo)) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <article>
          <header className="mb-6">
            <Link
              href="/"
              className="text-xs text-black/40 transition hover:text-black dark:text-white/40 dark:hover:text-white"
            >
              ← LifeFrame
            </Link>
            <h1 className="mt-4 text-2xl font-light text-black dark:text-white">
              需要登录查看
            </h1>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">
              这张照片包含人物，需要登录后才能查看。
            </p>
            <Link
              href={`/login?next=${encodeURIComponent(`/photos/${id}`)}`}
              className="mt-4 inline-block rounded-full bg-black px-6 py-2 text-sm font-medium text-white transition hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              登录查看 →
            </Link>
          </header>
        </article>
      </main>
    );
  }

  // Private photos: owner or admin only. canViewPhoto already
  // handled the guest case above, so this only fires for
  // authenticated non-owner non-admin users.
  if (
    photo.visibility === 'private' &&
    viewer.userId !== photo.user_id &&
    viewer.role !== 'admin'
  ) {
    notFound();
  }

  const takenAt = photo.taken_at
    ? new Date(photo.taken_at).toLocaleString('zh-CN')
    : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <article>
        <header className="mb-6">
          <Link
            href="/"
            className="text-xs text-black/40 transition hover:text-black dark:text-white/40 dark:hover:text-white"
          >
            ← LifeFrame
          </Link>
          <h1 className="mt-4 text-2xl font-light text-black dark:text-white">
            {photo.filename}
          </h1>
          {takenAt && (
            <p className="mt-1 text-sm text-black/50 dark:text-white/50">
              📅 {takenAt}
            </p>
          )}
          {photo.location_name && (
            <p className="text-sm text-black/50 dark:text-white/50">
              📍 {photo.location_name}
            </p>
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
            src={photoImageUrl(photo)}
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
            href="/"
            className="text-sm text-black/60 transition hover:text-black dark:text-white/60 dark:hover:text-white"
          >
            在 LifeFrame 地球仪上，发现更多生活瞬间 →
          </Link>
        </footer>
      </article>
    </main>
  );
}
