import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const metadata: Metadata = {
  title: 'LifeFrame — 足迹统计',
  description:
    '按国家 / 城市分组的照片分布统计 — LifeFrame 走过的地方。',
  robots: { index: true, follow: true },
};

type PhotoRow = {
  location_name: string | null;
};

type LocationParts = { city: string; country: string };

/**
 * Parse a Nominatim-style "City, Region, Country" string into
 * { city, country }. Last comma-separated segment is country, first is
 * city. Middle segments are folded into city ("Kanagawa, Japan"
 → // "Kanagawa"). Empty / null returns null (skipped in stats).
 */
function parseLocation(loc: string | null): LocationParts | null {
  if (!loc) return null;
  const parts = loc
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  if (parts.length === 0) return null;
  const country = parts[parts.length - 1];
  const city = parts[0];
  return { city, country };
}

export default async function StatsPage() {
  // Fetch public/unlisted photos for stats. RLS already excludes
  // 'person' category photos for anon so this is automatic. The
  // visibility filter keeps private photos out of the public stats.
  //
  // try/catch for build-time prerender (see /welcome fix in 5698787).
  let photos: PhotoRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase
      .from('photos')
      .select('location_name')
      .in('visibility', ['public', 'unlisted']);
    photos = (data ?? []) as PhotoRow[];
  } catch {
    // Env not configured (build-time prerender).
  }

  // Group photos by country, then by city.
  const countryMap = new Map<string, Map<string, number>>();
  for (const p of photos) {
    const loc = parseLocation(p.location_name);
    if (!loc) continue;
    const cityMap = countryMap.get(loc.country) ?? new Map<string, number>();
    cityMap.set(loc.city, (cityMap.get(loc.city) ?? 0) + 1);
    countryMap.set(loc.country, cityMap);
  }

  // Convert to sorted array: countries by total photo count desc;
  // within each country, cities by count desc.
  const countries = [...countryMap.entries()]
    .map(([country, cities]) => ({
      country,
      total: [...cities.values()].reduce((s, n) => s + n, 0),
      cities: [...cities.entries()]
        .map(([city, count]) => ({ city, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.total - a.total);

  const totalPhotos = photos.length;
  const totalCountries = countries.length;
  const totalCities = countries.reduce((s, c) => s + c.cities.length, 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] text-black/40 dark:text-white/40 uppercase">
          Stats · §27
        </p>
        <h1 className="mt-2 text-3xl font-light text-black dark:text-white">
          🌍 足迹统计
        </h1>
        <p className="mt-2 text-sm text-black/40 dark:text-white/40">
          按国家和城市分组的照片分布
        </p>
      </header>

      <div className="mb-10 grid grid-cols-3 gap-4 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-6">
        <StatBox label="照片" value={totalPhotos} />
        <StatBox label="国家" value={totalCountries} />
        <StatBox label="城市" value={totalCities} />
      </div>

      {countries.length === 0 ? (
        <p className="text-black/40 dark:text-white/40">
          还没有带位置的照片
        </p>
      ) : (
        <div className="space-y-6">
          {countries.map((c) => (
            <section
              key={c.country}
              className="rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-5"
            >
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-xl font-light text-black dark:text-white">
                  {c.country}
                </h2>
                <span className="text-sm tabular-nums text-black/40 dark:text-white/40">
                  {c.total} 张
                </span>
              </div>
              <ul className="space-y-1.5">
                {c.cities.map((city) => (
                  <li
                    key={city.city}
                    className="flex items-baseline justify-between text-sm"
                  >
                    <span className="text-black/80 dark:text-white/80">
                      📍 {city.city}
                    </span>
                    <span className="tabular-nums text-black/40 dark:text-white/40">
                      {city.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-12 text-center text-sm text-black/40 dark:text-white/40">
        数据基于公开 + 不公开链接分享的照片（人物照片需登录可见）
      </p>
    </main>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-light tabular-nums text-black dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-widest text-black/40 dark:text-white/40">
        {label}
      </div>
    </div>
  );
}