import { geoOrthographic, geoPath } from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import countriesGeo from '@/lib/countries';
import { t, type Locale } from '@/lib/i18n';
import { photoImageUrl } from '@/lib/photo-url';
import type { PhotoStats, PhotoStatRow, PlaceStat } from '@/lib/photo-stats';
import { buildScaleFromYears } from '@/lib/timeline-scale';

/**
 * Frank #0906 round-15: the three feature-card mock-ups.
 *
 * They used to be hand-drawn SVGs made of flat colour blocks with
 * hard-coded numbers ("7 地点 · 224 张照片", four tiles all dated
 * "2013.03"), which is exactly the kind of thing that drifts out
 * of sync with the real archive. Now every mock-up is built from
 * the SAME photo rows as the hero (`stats`), so:
 *
 *   - the numbers are real (one query, one aggregation),
 *   - the pictures are real photos served through the app's own
 *     image proxy,
 *   - the dates and places on the chips are the photos' real EXIF
 *     values,
 *   - the mini-globe is a genuine orthographic projection of the
 *     real coordinates over the real coastline data.
 *
 * The mock-ups are plain HTML (not SVG) so nothing can be clipped
 * by a viewBox edge — that was the "0.5×" pill running off the
 * right edge of card 1 and card 3's caption sitting on the bottom
 * border.
 */

type FeatureKey = 'timeTravel' | 'lifeJourney' | 'autoOrganize';

export function FeaturesGrid({
  locale,
  stats,
}: {
  locale: Locale;
  stats: PhotoStats;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <FeatureCard
        locale={locale}
        featureKey="timeTravel"
        stat={
          stats.firstYear && stats.lastYear
            ? `${stats.firstYear}–${stats.lastYear}`
            : null
        }
        demo={<TimeTravelDemo locale={locale} stats={stats} />}
      />
      <FeatureCard
        locale={locale}
        featureKey="lifeJourney"
        stat={t(locale, 'features.demo.summary', {
          count: stats.totalPhotos,
          places: stats.totalPlaces,
        })}
        demo={<LifeJourneyDemo locale={locale} stats={stats} />}
      />
      <FeatureCard
        locale={locale}
        featureKey="autoOrganize"
        stat={t(locale, 'features.demo.exif')}
        demo={<AutoOrganizeDemo locale={locale} stats={stats} />}
      />
    </div>
  );
}

function FeatureCard({
  locale,
  featureKey,
  stat,
  demo,
}: {
  locale: Locale;
  featureKey: FeatureKey;
  stat: string | null;
  demo: React.ReactNode;
}) {
  const title = t(
    locale,
    `features.${featureKey}.title` as
      | 'features.timeTravel.title'
      | 'features.lifeJourney.title'
      | 'features.autoOrganize.title',
  );
  const body = t(
    locale,
    `features.${featureKey}.body` as
      | 'features.timeTravel.body'
      | 'features.lifeJourney.body'
      | 'features.autoOrganize.body',
  );
  const icon = {
    timeTravel: '⏳',
    lifeJourney: '🌏',
    autoOrganize: '📷',
  }[featureKey];
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]">
      <div className="border-b border-black/10 bg-black/[0.04] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-2xl" aria-hidden="true">
              {icon}
            </span>
            <h3 className="truncate text-base font-medium text-black dark:text-white">
              {title}
            </h3>
          </div>
          {/* Frank #0906 round-15: the "DEMO" badge is gone — the
              card now shows what the feature actually holds, read
              from the same data as the hero. */}
          {stat && (
            <span className="shrink-0 text-[11px] tabular-nums text-black/75 dark:text-white/80">
              {stat}
            </span>
          )}
        </div>
      </div>
      {/* Mock-up frame — fixed 16:10 aspect ratio so all three
          cards line up regardless of the inner content. */}
      <div className="aspect-[16/10] w-full overflow-hidden bg-white dark:bg-black">
        {demo}
      </div>
      <div className="p-5">
        <p className="text-sm leading-relaxed text-black/80 dark:text-white/85">
          {body}
        </p>
      </div>
    </article>
  );
}

/** Mini "app window" chrome used by all three mock-ups. */
function DemoChrome({
  title,
  right,
}: {
  title: string;
  right?: string | null;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-black/10 px-2.5 py-1 dark:border-white/10">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400/80"
        />
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80"
        />
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/80"
        />
        <span className="truncate text-[10px] text-black/75 dark:text-white/85">
          {title}
        </span>
      </div>
      {right && (
        <span className="shrink-0 text-[10px] tabular-nums text-black/75 dark:text-white/85">
          {right}
        </span>
      )}
    </div>
  );
}

// ─── Demo 1: Time Travel ───────────────────────────────────────────

function TimeTravelDemo({
  locale,
  stats,
}: {
  locale: Locale;
  stats: PhotoStats;
}) {
  const hero = stats.demo.hero;
  const strip = stats.demo.strip;
  const heroDate = hero ? formatDotDate(hero) : null;
  const heroPlace = hero ? cityLabel(hero) : null;

  // The mini-track uses the SAME scale as the real timeline
  // (lib/timeline-scale.ts): the years the archive has photos in,
  // with the empty stretches compressed. A linear year axis here
  // would show the very "two thirds empty" problem the real
  // timeline was fixed for.
  const miniScale = buildScaleFromYears(
    stats.years.map((y) => y.year),
    new Date(),
  );
  const marks = stats.years.map((y) => ({
    year: y.year,
    pos: miniScale.positionFor(new Date(y.year, 0, 1)),
  }));
  const playheadPos = hero
    ? miniScale.positionFor(new Date(hero.taken_at || hero.created_at))
    : 100;

  return (
    <div className="flex h-full flex-col text-black dark:text-white">
      <DemoChrome
        title={t(locale, 'features.timeTravel.title')}
        right={heroDate}
      />
      <div className="flex min-h-0 flex-1 gap-2 p-2.5">
        {/* The photo currently "on screen". */}
        <div className="relative min-w-0 flex-1 overflow-hidden rounded bg-black/10 dark:bg-white/5">
          {hero ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoImageUrl(hero, '256')}
                alt={hero.filename}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-3 pb-1 text-[9px] leading-tight text-white">
                {heroDate}
                {heroPlace ? ` · ${heroPlace}` : ''}
              </span>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-black/60 dark:text-white/75">
              —
            </div>
          )}
        </div>
        {/* The chapter strip — one real photo per year. */}
        <div className="flex w-[38%] shrink-0 flex-col gap-1">
          {strip.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-[10px] text-black/60 dark:text-white/75">
              —
            </div>
          )}
          {strip.map((p) => (
            <div key={p.id} className="flex min-h-0 flex-1 items-center gap-1.5">
              <div className="relative h-full min-h-0 w-12 shrink-0 overflow-hidden rounded bg-black/10 dark:bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoImageUrl(p, '256')}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
              <span className="truncate text-[9px] tabular-nums text-black/75 dark:text-white/85">
                {String(new Date(p.taken_at || p.created_at).getFullYear())}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* Mini transport: real year marks + the speed pills. Both
          live inside the frame's padding, so nothing is clipped. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-black/10 px-2.5 py-1.5 dark:border-white/10">
        <div className="relative h-4 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1 h-0.5 rounded-full bg-black/15 dark:bg-white/20" />
          {marks.map((m) => (
            <span
              key={m.year}
              className="absolute top-0.5 h-2 w-px bg-black/40 dark:bg-white/50"
              style={{ left: `${m.pos}%` }}
            />
          ))}
          {/* The playhead sits on the newest photo. */}
          <span
            className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-500 ring-2 ring-white/60 dark:bg-cyan-400 dark:ring-black/50"
            style={{ left: `${playheadPos}%` }}
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/20 p-0.5 dark:border-white/25">
          {['0.5×', '1×', '2×', '4×'].map((s) => (
            <span
              key={s}
              className={`rounded-full px-1.5 py-0.5 text-[9px] leading-none ${
                s === '1×'
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-black/75 dark:text-white/80'
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Demo 2: Life Journey ──────────────────────────────────────────

/** How many places the mock-up lists. */
const DEMO_PLACES = 7;

/** Mini-globe geometry. */
const MINI_R = 56;
const MINI_SIZE = MINI_R * 2 + 6;

/**
 * Country outlines for the mini-globe, memoised per globe centre.
 * The projection is the same orthographic one the real globe uses,
 * so the mock-up is a true miniature of the app's globe.
 */
const miniPathCache = new Map<
  string,
  Array<{ id: string | number; d: string }>
>();

function miniGlobePaths(centerLng: number, centerLat: number) {
  const key = `${centerLng.toFixed(1)},${centerLat.toFixed(1)}`;
  const hit = miniPathCache.get(key);
  if (hit) return hit;
  const projection = geoOrthographic()
    // Negated: d3 rotates the globe, so rotate([-lng, -lat]) puts
    // the point (lng, lat) at the centre of the disc.
    .rotate([-centerLng, -centerLat])
    .scale(MINI_R)
    .translate([MINI_SIZE / 2, MINI_SIZE / 2])
    .clipAngle(90)
    .precision(0.5);
  const pathFn = geoPath(projection);
  const out: Array<{ id: string | number; d: string }> = [];
  countriesGeo.features.forEach((f: Feature<Geometry, any>, i: number) => {
    const d = pathFn(f as any);
    if (d) out.push({ id: (f.id as string | number | undefined) ?? i, d });
  });
  miniPathCache.set(key, out);
  return out;
}

function LifeJourneyDemo({
  locale,
  stats,
}: {
  locale: Locale;
  stats: PhotoStats;
}) {
  const places = stats.places.slice(0, DEMO_PLACES);
  const [lng, lat] = stats.center;
  const paths = miniGlobePaths(lng, lat);

  // Marker positions for the listed places (real coordinates).
  const projection = geoOrthographic()
    .rotate([-lng, -lat])
    .scale(MINI_R)
    .translate([MINI_SIZE / 2, MINI_SIZE / 2])
    .clipAngle(90)
    .precision(0.5);
  const markers = places
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const xy = projection([p.lng as number, p.lat as number]);
      return { place: p, xy };
    })
    .filter((m): m is { place: PlaceStat; xy: [number, number] } => Boolean(m.xy));

  // The real globe merges markers that sit close together into one
  // count badge. The mock-up does the same, otherwise the badges
  // for two neighbouring cities would sit on top of each other.
  const clusters: Array<{ key: string; x: number; y: number; count: number }> = [];
  for (const m of markers) {
    const hit = clusters.find(
      (c) => Math.hypot(c.x - m.xy[0], c.y - m.xy[1]) < 9,
    );
    if (hit) {
      hit.count += m.place.count;
    } else {
      clusters.push({
        key: m.place.key,
        x: m.xy[0],
        y: m.xy[1],
        count: m.place.count,
      });
    }
  }

  return (
    <div className="flex h-full flex-col text-black dark:text-white">
      <DemoChrome
        title={t(locale, 'features.lifeJourney.title')}
        right={t(locale, 'features.demo.summary', {
          count: stats.totalPhotos,
          places: stats.totalPlaces,
        })}
      />
      <div className="flex min-h-0 flex-1 items-center gap-2 p-2">
        {/* Mini globe — real projection, real coastline, real
            markers. */}
        <div
          className="relative shrink-0"
          style={{ width: MINI_SIZE, height: MINI_SIZE }}
        >
          <svg
            viewBox={`0 0 ${MINI_SIZE} ${MINI_SIZE}`}
            width={MINI_SIZE}
            height={MINI_SIZE}
            role="img"
            aria-label={t(locale, 'features.lifeJourney.title')}
            className="block"
          >
            <defs>
              <radialGradient id="miniOcean" cx="38%" cy="35%" r="75%">
                <stop offset="0%" stopColor="var(--ocean-light)" />
                <stop offset="65%" stopColor="var(--ocean-mid)" />
                <stop offset="100%" stopColor="var(--ocean-dark)" />
              </radialGradient>
            </defs>
            <circle
              cx={MINI_SIZE / 2}
              cy={MINI_SIZE / 2}
              r={MINI_R}
              fill="url(#miniOcean)"
              stroke="var(--accent)"
              strokeOpacity={0.45}
              strokeWidth={1}
            />
            {paths.map((c) => (
              <path
                key={c.id}
                d={c.d}
                fill="var(--country-fill)"
                stroke="var(--country-stroke)"
                strokeWidth={0.7}
              />
            ))}
            {clusters.map((c) => (
              <g key={c.key}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={6}
                  fill="var(--accent-soft)"
                  pointerEvents="none"
                />
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={4}
                  fill="var(--accent)"
                  fillOpacity={0.5}
                  stroke="var(--marker-stroke)"
                  strokeWidth={0.8}
                  pointerEvents="none"
                />
                <text
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dy="0.35em"
                  fontSize={5.5}
                  fontWeight="bold"
                  fill="var(--bg-primary)"
                  pointerEvents="none"
                >
                  {c.count}
                </text>
              </g>
            ))}
          </svg>
        </div>
        {/* The place list — one row per place, each with its own
            photo count. No overlapping labels: the names live in
            a list, not on top of the globe. */}
        <ul className="flex min-w-0 flex-1 flex-col justify-between gap-0.5">
          {places.length === 0 && (
            <li className="text-[10px] text-black/70 dark:text-white/80">—</li>
          )}
          {places.map((p) => (
            <li
              key={p.key}
              className="flex min-w-0 items-center gap-1.5 text-[10px]"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500 dark:bg-cyan-400"
              />
              <span className="min-w-0 flex-1 truncate text-black/85 dark:text-white/90">
                {p.name}
              </span>
              <span className="shrink-0 tabular-nums text-black/75 dark:text-white/80">
                {p.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Demo 3: Auto Organize ─────────────────────────────────────────

function AutoOrganizeDemo({
  locale,
  stats,
}: {
  locale: Locale;
  stats: PhotoStats;
}) {
  const tiles = stats.demo.grid;
  return (
    <div className="flex h-full flex-col text-black dark:text-white">
      <DemoChrome
        title={t(locale, 'features.autoOrganize.title')}
        right={t(locale, 'features.demo.exif')}
      />
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5 p-2">
        {tiles.length === 0 && (
          <div className="col-span-2 flex items-center justify-center text-[10px] text-black/70 dark:text-white/80">
            —
          </div>
        )}
        {tiles.map((p) => {
          const date = formatDotDate(p);
          const place = cityLabel(p);
          return (
            <div
              key={p.id}
              className="relative min-h-0 overflow-hidden rounded bg-black/10 dark:bg-white/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoImageUrl(p, '256')}
                alt={p.filename}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              {/* The auto-tag chips: the photo's real place and its
                  real EXIF date. */}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1 bg-gradient-to-t from-black/90 to-transparent px-1 pt-3 pb-0.5">
                <span className="max-w-[58%] truncate rounded-full bg-white/25 px-1.5 py-px text-[8px] leading-[1.3] text-white">
                  📍 {place}
                </span>
                <span className="rounded-full bg-white/25 px-1.5 py-px text-[8px] leading-[1.3] tabular-nums text-white">
                  📅 {date}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Caption — sits inside the frame with its own padding so it
          can never touch the bottom edge. */}
      <p className="shrink-0 px-2.5 pb-1.5 text-[9px] leading-tight text-black/75 dark:text-white/85">
        {t(locale, 'features.demo.exifNote')}
      </p>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────

/** "2013.05" — the photo's own date. */
function formatDotDate(p: PhotoStatRow): string {
  const d = new Date(p.taken_at || p.created_at);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The photo's city (first segment of the location string). */
function cityLabel(p: PhotoStatRow): string {
  const raw = (p.location_name ?? '').trim();
  if (!raw) return '—';
  return raw.split(',')[0].trim();
}
