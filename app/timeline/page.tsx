import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'LifeFrame — 时间线浏览',
  description:
    '按月份浏览所有公开的风景照片。LifeFrame 的第二种浏览模式 — 不只是 3D 地球仪。',
  robots: { index: true, follow: true },
};

type PhotoRow = {
  key: string;
  thumbnail_url: string | null;
  public_url: string;
  filename: string;
  taken_at: string | null;
  created_at: string;
  location_name: string | null;
};

type MonthGroup = {
  key: string; // YYYY-MM
  label: string; // e.g. "2026 年 8 月"
  photos: PhotoRow[];
};

function groupByMonth(photos: PhotoRow[]): MonthGroup[] {
  const map = new Map<string, PhotoRow[]>();
  for (const p of photos) {
    const ts = p.taken_at || p.created_at;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  // Sort month buckets newest-first.
  const sorted = [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  return sorted.map(([key, photos]) => {
    const [y, m] = key.split('-');
    return {
      key,
      label: `${y} 年 ${parseInt(m, 10)} 月`,
      photos,
    };
  });
}

export default async function TimelinePage() {
  // PRD §15: Timeline View — second browsing mode. Public-ish page:
  // anonymous-key fetch via createSupabaseServerClient, but we explicitly
  // filter to public + unlisted so private photos stay owner-only
  // per §24 (the public gallery is for sharing; the full home page
  // / is the authed owner's "see everything" surface).
  //
  // Same try/catch pattern as /welcome (Frank #7081): if env is
  // missing during `next build` prerender, render the page header
  // + "还没有照片" instead of failing the build.
  let all: PhotoRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data: photos } = await supabase
      .from('photos')
      .select(
        'key, thumbnail_url, public_url, filename, taken_at, created_at, location_name',
      )
      .in('visibility', ['public', 'unlisted'])
      .order('taken_at', { ascending: false })
      .limit(500);
    all = photos ?? [];
  } catch {
    // Env not configured (build-time prerender) or transient error.
  }
  const months = groupByMonth(all);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Timeline View · §15
        </p>
        <h1 className="mt-2 text-3xl font-light text-black dark:text-white">
          时间线浏览
        </h1>
        <p className="mt-2 text-sm text-black/40 dark:text-white/40">
          按月份分组，共 {all.length} 张照片
        </p>
      </header>

      {months.length === 0 ? (
        <p className="text-black/40 dark:text-white/40">还没有照片</p>
      ) : (
        <div className="space-y-12">
          {months.map((m) => (
            <section key={m.key}>
              <h2 className="mb-4 flex items-baseline gap-3 text-xl font-light text-black dark:text-white">
                {m.label}
                <span className="text-sm text-black/40 dark:text-white/40">
                  ({m.photos.length})
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {m.photos.map((p) => (
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
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-center text-sm text-black/40 dark:text-white/40">
        <Link
          href="/"
          className="transition hover:text-black dark:hover:text-white"
        >
          ← 返回首页
        </Link>
      </p>
    </main>
  );
}