import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type PhotoRow = {
  key: string;
  thumbnail_url: string | null;
  public_url: string;
  filename: string;
  taken_at: string | null;
  created_at: string;
  location_name: string | null;
};

type Params = { month: string }; // e.g. "2026-08"

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { month } = await params;
  return {
    title: `LifeFrame — ${month.replace('-', ' 年 ')} 月`,
    description: `${month} 月份所有公开照片 — LifeFrame 时间线。`,
    robots: { index: true, follow: true },
  };
}

export default async function MonthPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { month } = await params;
  // Match YYYY-MM strictly — reject anything else so /timeline/foo
  // doesn't silently render an empty page.
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();

  let photos: PhotoRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('photos')
      .select(
        'key, thumbnail_url, public_url, filename, taken_at, created_at, location_name',
      )
      .in('visibility', ['public', 'unlisted'])
      // Range fetch by year-month start..next-month-start. taken_at
      // is the primary ts (created_at is the fallback). The gte/lt
      // range is inclusive/exclusive on ISO date strings so this
      // works without touching PostgREST date math.
      .gte('taken_at', `${month}-01`)
      .lt('taken_at', `${nextMonth(month)}-01`)
      .order('taken_at', { ascending: false })
      .limit(500);
    photos = data ?? [];
  } catch {
    // Env missing or transient; render whatever we have (likely empty).
  }

  const [y, m] = month.split('-');
  const label = `${y} 年 ${parseInt(m, 10)} 月`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Timeline · {month}
        </p>
        <h1 className="mt-2 text-3xl font-light text-black dark:text-white">
          {label}
        </h1>
        <p className="mt-2 text-sm text-black/40 dark:text-white/40">
          共 {photos.length} 张照片
        </p>
        <p className="mt-4">
          <Link
            href="/timeline"
            className="text-sm text-black/70 dark:text-white/70 transition hover:text-black dark:hover:text-white"
          >
            ← 返回时间线
          </Link>
        </p>
      </header>

      {photos.length === 0 ? (
        <p className="text-black/40 dark:text-white/40">
          这个月还没有照片。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {photos.map((p) => (
            <Link
              key={p.key}
              href={`/p/${encodeURIComponent(p.key)}`}
              className="group relative overflow-hidden rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] transition hover:border-black/30 dark:hover:border-white/30"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.thumbnail_url || p.public_url}
                alt={p.filename}
                className="aspect-square w-full object-cover transition group-hover:scale-105"
                loading="lazy"
              />
              {p.location_name && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="truncate text-xs text-white/90">
                    📍 {p.location_name}
                  </p>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

/** Returns "YYYY-MM" for the month after the given YYYY-MM. Used
 *  to build the .lt() upper bound on the photos range query. */
function nextMonth(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d2 = new Date(Date.UTC(y, m - 1 + 1, 1));
  return `${d2.getUTCFullYear()}-${String(d2.getUTCMonth() + 1).padStart(2, '0')}`;
}