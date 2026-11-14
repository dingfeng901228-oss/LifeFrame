import type { Metadata } from 'next';
import { getPhotoRows, parseLocation } from '@/lib/photo-stats';
import { WorldDotMap } from '@/components/WorldDotMap';
import { CollapseGroupButton } from '@/components/CollapseCountryButton';
import { StatsSearch } from '@/components/StatsSearch';
import { StatsExport } from '@/components/StatsExport';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'LifeFrame — 足迹统计',
  description:
    '按国家 / 城市分组的照片分布统计 — LifeFrame 走过的地方。',
  robots: { index: true, follow: true },
};

type PhotoRow = {
  location_name: string | null;
  key: string;
  filename: string;
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Parse a Nominatim-style "City, Region, Country" string into
 * { city, country }. Last comma-separated segment is country, first is
 * city. Middle segments are folded into city ("Kanagawa, Japan"
 → // "Kanagawa"). Empty / null returns null (skipped in stats).
 *
 * Frank #0906 round-14: skip Chinese / Japanese admin levels
 * (province/prefecture/district/ward/city-with-suffix) so the
 * last segment is actually the country. Without the filter Frank's
 * location strings (e.g. "威海市, 山东省, 中国" parsed as
 * country=山东省 because of "山东省" being the second-to-last
 * segment when the actual country is "中国") fragment the stats
 * page into 27 mostly-unrecognised "countries".
 */
export default async function StatsPage() {
  // Frank #0906 round-14 cont.: read locale so the export menu
  // + section labels can flip with the site-wide language switcher.
  const { getLocale } = await import('@/lib/i18n-server');
  const locale = await getLocale();

  // Frank #0906 round-15: the SAME rows the landing page counts
  // (one query, one aggregation). The old query added its own
  // `visibility in ('public','unlisted')` filter on top of RLS, so
  // this page and the homepage could disagree by a photo.
  const photos = (await getPhotoRows()) as PhotoRow[];

  // Frank #0906 round-14 (round-14 cont.): flatten to one card
  // per CITY (was: one card per country, with cities listed inside).
  // The hierarchy was confusing for the user because the per-country
  // aggregate was the bulk of what users want to see ("how many
  // photos did I take in Tokyo?"), but the structure made that
  // the second-level item under each country header.
  //
  // We still keep country as a small subtitle on each city card
  // so the geographic context isn't lost (and so the map dots still
  // match — the dot at 日本.cn.coords represents the sum of all
  // Japanese cities, which the cards list separately).
  const cityMap = new Map<string, { city: string; country: string; count: number }>();
  for (const p of photos) {
    const loc = parseLocation(p.location_name);
    if (!loc) continue;
    // If the city already exists in this country, increment; else
    // add a new entry. Key by city+country to avoid collisions
    // between cities of the same name in different countries
    // (e.g. London UK vs. London ON).
    const key = `${loc.country}::${loc.city}`;
    const existing = cityMap.get(key);
    if (existing) existing.count += 1;
    else cityMap.set(key, { city: loc.city, country: loc.country, count: 1 });
  }
  const cities = [...cityMap.values()].sort((a, b) => b.count - a.count);

  const totalPhotos = photos.length;
  // Still compute country distinct count for the stat tile, even
  // though we don't render country groups any more.
  const totalCountries = new Set(cities.map((c) => c.country)).size;
  const totalCities = cities.length;

  // Aggregate per country for the WorldDotMap. The map is the only
  // place countries appear (cards are city-first now). Sorted by
  // total desc so the dot sizes are still in a meaningful order.
  const countryMap = new Map<string, number>();
  for (const c of cities) {
    countryMap.set(c.country, (countryMap.get(c.country) ?? 0) + c.count);
  }
  const countriesForMap = [...countryMap.entries()]
    .map(([country, total]) => ({
      country,
      total,
      // cities array isn't needed by WorldDotMap but the type
      // requires it. Send an empty list (the cards above handle
      // the per-city breakdown).
      cities: [],
    }))
    .sort((a, b) => b.total - a.total);

  // Frank #0906 round-14 cont.: per-photo rows for the detailed
  // export ("one row per photo" CSV/JSON). Sort by taken_at
  // ascending so the export reads as a chronological log; photos
  // without taken_at land at the bottom (alphabetical by key
  // for stable order).
  const detailedRows = photos
    .map((p) => {
      const loc = parseLocation(p.location_name);
      return {
        country: loc?.country ?? '未分类',
        city: loc?.city ?? p.location_name ?? '未分类',
        takenAt: p.taken_at ?? '',
        key: p.key,
        filename: p.filename,
        lat: p.lat,
        lng: p.lng,
      };
    })
    .sort((a, b) => {
      if (a.takenAt && b.takenAt) return a.takenAt.localeCompare(b.takenAt);
      if (a.takenAt) return -1;
      if (b.takenAt) return 1;
      return a.key.localeCompare(b.key);
    });

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <p className="text-xs tracking-[0.4em] text-black/70 dark:text-white/70 uppercase">
          Stats · §27
        </p>
        <h1 className="mt-2 text-3xl font-light text-black dark:text-white">
          🌍 足迹统计
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          按城市分组的照片分布
        </p>
        {/* Frank #0906 round-14 cont.: top-of-page search filters
            both the city cards (by data-stats-loc="city|country")
            and the world map dots (by data-stats-country). The
            component reads the DOM directly to keep the cards
            server-rendered; the input itself is the only client
            island here. */}
        <StatsSearch total={totalCities} />
      </header>

      {/* Frank #0906 round-14 (Batch C): top row keeps the three
          big-number tiles but adds a 1-row mini equirectangular
          world map below, where each cyan dot is one country
          (positioned by centroid, sized by photo count). Below
          the map the country list is now collapsed by default
          (Frank #7108 collapse pattern) so the page is one
          screenful on desktop. The map dots and the country
          cards are linked: clicking a dot expands the matching
          card via the CollapseCountryButton toggle. */}
      <div className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-white/10 bg-white/[0.02] p-6">
        <StatBox label="照片" value={totalPhotos} />
        <StatBox label="国家" value={totalCountries} />
        <StatBox label="城市" value={totalCities} />
      </div>

      {cities.length === 0 ? (
        <p className="text-black/70 dark:text-white/70">
          还没有带位置的照片
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-[var(--text-muted)]">
              {t(locale, 'stats.worldMap')}
            </h2>
            <StatsExport
              locale={locale}
              rows={cities}
              detailedRows={detailedRows}
              totalPhotos={totalPhotos}
              label={t(locale, 'stats.exportLabel')}
              buttonLabel={t(locale, 'stats.exportButton')}
              csvLabel={t(locale, 'stats.exportCsv')}
              jsonLabel={t(locale, 'stats.exportJson')}
              csvDetailLabel={t(locale, 'stats.exportCsvDetail')}
              jsonDetailLabel={t(locale, 'stats.exportJsonDetail')}
              downloadedLabel={t(locale, 'stats.exportDownloaded')}
            />
          </div>
          <WorldDotMap countries={countriesForMap} />
          <div className="mt-8 space-y-3">
            {cities.map((c) => (
              <CityCard
                key={`${c.country}::${c.city}`}
                city={c.city}
                country={c.country}
                total={c.count}
              />
            ))}
          </div>
        </>
      )}

      <p className="mt-12 text-center text-sm text-black/80 dark:text-white/75">
        数据基于当前账号可见的照片（人物照片需登录可见）
      </p>
    </main>
  );
}

function CityCard({
  city,
  country,
  total,
}: {
  city: string;
  country: string;
  total: number;
}) {
  // Each card is a single city. Country is shown as a subtitle
  // (small grey text under the city name) so the geographic
  // context is still visible. id="city-<region>" matches what
  // the WorldDotMap dispatches via expandCountryCard().
  //
  // Frank #0906 round-14 (round-14 cont.): use `text-white` for
  // the title and `[var(--text-primary)]` for the subtitle (CSS
  // var) instead of `text-black dark:text-white`. The Stats page
  // is dark-by-design (body bg black), and Tailwind's `dark:`
  // variant only fires when <html class="dark"> is set — which
  // depends on the theme bootstrap script and can lag behind
  // first paint. Using the CSS var sidesteps that race entirely.
  return (
    <section
      id={`city-${city}-${country}`}
      data-stats-loc={`${city} ${country}`}
      className="rounded-lg border border-black/10 bg-white/[0.5] dark:border-white/10 dark:bg-white/[0.02]"
    >
      <CollapseGroupButton
        title={city}
        subtitle={country}
        total={total}
        itemCount={undefined}
      >
        <div className="text-xs text-[var(--text-muted)]">
          {total} 张照片摄于{city}
        </div>
      </CollapseGroupButton>
    </section>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="text-3xl font-light tabular-nums text-black dark:text-white">
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}
