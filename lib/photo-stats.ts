import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from './supabase-server';

/**
 * Frank #0906 round-15: ONE source of truth for every photo / place
 * number the site shows.
 *
 * Before this module the landing page printed three different
 * photo counts side by side:
 *
 *   - the hero said "N 张照片已点亮地点" (from the client-side
 *     gallery fetch),
 *   - the 人生足迹 feature-card demo was a hard-coded SVG that
 *     said "7 地点 · 224 张照片",
 *   - the timeline's year-jump buttons summed to yet another
 *     number (they counted `taken_at` only, so photos without an
 *     EXIF date were missing).
 *
 * Every number now comes from `computePhotoStats()` over ONE query
 * (`fetchPhotoRows`) with ONE row set, so the hero, the three
 * feature-card demos, the timeline and /stats can never drift
 * apart again.
 *
 * The row set is whatever Postgres Row Level Security lets the
 * current viewer see — the same rule the homepage gallery already
 * used. A guest sees the public archive; the owner sees
 * everything. No extra `visibility` filter is applied on top, so
 * the homepage and /stats agree exactly.
 */

export type PhotoStatRow = {
  id: string;
  key: string;
  filename: string;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  taken_at: string | null;
  created_at: string;
  visibility: string | null;
  categories: string[] | null;
};

/** The one SELECT used by every consumer of the photo archive. */
export const PHOTO_STATS_SELECT =
  'id, key, filename, location_name, lat, lng, taken_at, created_at, visibility, categories';

export type PlaceStat = {
  /** City name — the first comma segment of `location_name`. */
  name: string;
  /** The country the city belongs to (parsed, never guessed). */
  country: string;
  /** Stable key: `${country}::${city}` — the same key /stats uses. */
  key: string;
  /** The full raw location string (city, region, country). */
  raw: string;
  /** How many photos carry this city. */
  count: number;
  /** Representative coordinate (mean of the city's photos). */
  lat: number | null;
  lng: number | null;
};

export type YearStat = {
  year: number;
  count: number;
};

export type PhotoStats = {
  /** Rows in the archive the viewer can see. */
  totalPhotos: number;
  /** Distinct cities (places) among those photos. */
  totalPlaces: number;
  /** Cities, most-photographed first. */
  places: PlaceStat[];
  /** Years that have at least one photo, oldest first. */
  years: YearStat[];
  /** Photos per year, keyed by year. */
  yearCounts: Map<number, number>;
  firstYear: number | null;
  lastYear: number | null;
  /** Earliest photo timestamp (ISO) — the timeline's left edge. */
  firstDate: string | null;
  /** Mean position of the geo-tagged photos: [lng, lat]. */
  center: [number, number];
  /** Real photos used to build the three feature-card demos. */
  demo: {
    /** The newest publicly viewable photo (time-travel hero). */
    hero: PhotoStatRow | null;
    /** One photo per distinct year (time-travel strip). */
    strip: PhotoStatRow[];
    /** Four photos with distinct dates + places (auto-organize grid). */
    grid: PhotoStatRow[];
  };
};

/** Run the canonical photo query against any Supabase client. */
export async function fetchPhotoRows(
  client: SupabaseClient,
): Promise<PhotoStatRow[]> {
  const { data, error } = await client
    .from('photos')
    .select(PHOTO_STATS_SELECT)
    .order('taken_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PhotoStatRow[];
}

/**
 * City name of a raw location string. Same rule the /stats page
 * uses: the FIRST comma segment is the city ("威海市, 山东省" →
 * "威海市"); the remaining segments are region / country.
 */
export function cityOf(locationName: string | null | undefined): string {
  if (!locationName) return '';
  return locationName.split(',')[0].trim();
}

/**
 * Frank #0906 round-15: ONE definition of "place", shared by the
 * landing page and /stats.
 *
 * Previously the landing page counted distinct city NAMES while
 * /stats counted distinct (country, city) pairs — the same place
 * under two countries (「北京市」 with and without a country, 「中野」
 * under two districts) was one place on the home page and two on
 * the stats page. Both now use (country, city).
 */
export type LocationParts = { city: string; country: string };

const ADMIN_LEVELS_CN = new Set([
  '北京市', '上海市', '天津市', '重庆市',
  '河北省', '山西省', '辽宁省', '吉林省', '黑龙江省',
  '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '海南省',
  '四川省', '贵州省', '云南省', '陕西省', '甘肃省', '青海省',
  '台湾省',
  '内蒙古自治区', '广西壮族自治区', '西藏自治区', '宁夏回族自治区', '新疆维吾尔自治区',
  '香港特别行政区', '澳门特别行政区',
]);
// Japanese prefectures end in 都/道/府/県.
const JP_PREF = new Set([
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]);
// Korean provinces + 도.
const KR_PREF = new Set([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시',
  '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도',
]);

function isAdminLevelCN(s: string): boolean {
  if (ADMIN_LEVELS_CN.has(s)) return true;
  if (JP_PREF.has(s)) return true;
  if (KR_PREF.has(s)) return true;
  // Generic CN: district 县/区/市 + ward 街道/镇/乡/村
  if (/(?:区|县|镇|乡|村|街道)$/.test(s)) return true;
  return false;
}

export function parseLocation(loc: string | null): LocationParts | null {
  if (!loc) return null;
  const parts = loc
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  // Frank #0906 round-14 (round-14 cont.): single-segment inputs
  // (e.g. just "威海市" with no country suffix) are common. Without
  // handling, parseLocation returns {city: "威海市", country: "威海市"}
  // — and the city card shows the same name twice. Treat
  // single-segment as "city with unknown country" so it shows up
  // in the city list (not lost) but doesn't duplicate the label.
  if (parts.length === 1) {
    return { city: parts[0], country: '未分类' };
  }
  let country = parts[parts.length - 1];
  // Drop trailing admin levels until we hit something that looks
  // like a real country name. If everything drops out, fall back
  // to "未分类" so the row stays in the city list.
  while (isAdminLevelCN(country) && parts.length > 1) {
    parts.pop();
    country = parts[parts.length - 1];
  }
  if (isAdminLevelCN(country)) {
    country = '未分类';
  }
  return { city: parts[0], country };
}



/** Can a signed-out visitor see this photo's picture? */
export function isPubliclyViewable(row: PhotoStatRow): boolean {
  if (row.visibility !== 'public') return false;
  return !(row.categories ?? []).includes('person');
}

function photoDate(row: PhotoStatRow): Date | null {
  const ts = row.taken_at || row.created_at;
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Aggregate the photo rows into every number the UI shows.
 * Pure function — no I/O — so the same rows always produce the
 * same counts.
 */
export function computePhotoStats(rows: PhotoStatRow[]): PhotoStats {
  const totalPhotos = rows.length;

  // ── Places (cities) ─────────────────────────────────────────────
  const placeMap = new Map<
    string,
    PlaceStat & { latSum: number; lngSum: number; n: number }
  >();
  for (const row of rows) {
    const raw = (row.location_name ?? '').trim();
    if (!raw) continue;
    const parsed = parseLocation(raw);
    if (!parsed || !parsed.city) continue;
    // One key per (country, city) — the same key /stats groups by,
    // so both pages count the same places.
    const key = `${parsed.country}::${parsed.city}`;
    let entry = placeMap.get(key);
    if (!entry) {
      entry = {
        name: parsed.city,
        country: parsed.country,
        key,
        raw,
        count: 0,
        lat: null,
        lng: null,
        latSum: 0,
        lngSum: 0,
        n: 0,
      };
      placeMap.set(key, entry);
    }
    entry.count += 1;
    if (row.lat != null && row.lng != null) {
      entry.latSum += row.lat;
      entry.lngSum += row.lng;
      entry.n += 1;
    }
  }
  const places: PlaceStat[] = [...placeMap.values()]
    .map((p) => ({
      name: p.name,
      country: p.country,
      key: p.key,
      raw: p.raw,
      count: p.count,
      lat: p.n ? p.latSum / p.n : null,
      lng: p.n ? p.lngSum / p.n : null,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // ── Years ───────────────────────────────────────────────────────
  const yearCounts = new Map<number, number>();
  let firstMs = Infinity;
  let firstDate: string | null = null;
  for (const row of rows) {
    const d = photoDate(row);
    if (!d) continue;
    const y = d.getFullYear();
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
    if (d.getTime() < firstMs) {
      firstMs = d.getTime();
      firstDate = (row.taken_at || row.created_at) as string;
    }
  }
  const years: YearStat[] = [...yearCounts.entries()]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year);

  // ── Mean position of the geo-tagged photos (globe centre) ───────
  let lngSum = 0;
  let latSum = 0;
  let n = 0;
  for (const row of rows) {
    if (row.lat == null || row.lng == null) continue;
    lngSum += row.lng;
    latSum += row.lat;
    n += 1;
  }
  const center: [number, number] = n ? [lngSum / n, latSum / n] : [0, 0];

  // ── Demo photos ─────────────────────────────────────────────────
  const publicRows = rows.filter(isPubliclyViewable);
  const dated = publicRows
    .filter((r) => photoDate(r))
    .sort((a, b) => (photoDate(a)!.getTime() - photoDate(b)!.getTime()));

  const hero = dated.length ? dated[dated.length - 1] : null;

  // One photo per year, spread over the archive: first year, the
  // middle, and the most recent one with photos.
  const strip: PhotoStatRow[] = [];
  const usedYears = new Set<number>();
  const pickYears = (() => {
    const ys = [...yearCounts.keys()].sort((a, b) => a - b);
    if (ys.length === 0) return [];
    if (ys.length === 1) return ys;
    if (ys.length === 2) return ys;
    return [ys[0], ys[Math.floor((ys.length - 1) / 2)], ys[ys.length - 1]];
  })();
  for (const y of pickYears) {
    const row = dated.find((r) => photoDate(r)!.getFullYear() === y);
    if (row && !usedYears.has(y)) {
      usedYears.add(y);
      strip.push(row);
    }
  }

  // Four photos with four different dates AND four different
  // cities, so the auto-organize demo shows four distinct chips.
  const grid: PhotoStatRow[] = [];
  const gridDates = new Set<string>();
  const gridCities = new Set<string>();
  for (const row of [...dated].reverse()) {
    if (grid.length >= 4) break;
    const d = photoDate(row)!;
    const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const parsed = parseLocation(row.location_name);
    const city = parsed?.city || row.filename;
    if (gridDates.has(dateKey) || gridCities.has(city)) continue;
    gridDates.add(dateKey);
    gridCities.add(city);
    grid.push(row);
  }

  return {
    totalPhotos,
    totalPlaces: places.length,
    places,
    years,
    yearCounts,
    firstYear: years.length ? years[0].year : null,
    lastYear: years.length ? years[years.length - 1].year : null,
    firstDate,
    center,
    demo: { hero, strip, grid },
  };
}

/**
 * Server-side entry point: read the archive rows through the
 * current request's cookies (RLS applies). Used by /stats, which
 * needs the raw rows for its per-photo export.
 */
export async function getPhotoRows(): Promise<PhotoStatRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    return await fetchPhotoRows(supabase);
  } catch {
    return [];
  }
}

/**
 * Server-side entry point: read the archive through the current
 * request's cookies (RLS applies) and aggregate it.
 *
 * Returns an empty-but-valid stats object when Supabase isn't
 * configured (e.g. during a build-time prerender) so the page
 * still renders.
 */
export async function getPhotoStats(): Promise<PhotoStats> {
  let rows: PhotoStatRow[] = [];
  try {
    const supabase = await createSupabaseServerClient();
    rows = await fetchPhotoRows(supabase);
  } catch {
    rows = [];
  }
  return computePhotoStats(rows);
}

/**
 * Rotation (degrees) that centres the orthographic globe on the
 * photo archive. d3's `rotate([λ, φ])` puts the geographic point
 * (λ, φ) at the centre of the disc.
 *
 * The globe used to be hard-wired to `rotate([0, 0])` — the
 * Atlantic — which is why a China/Japan archive showed a globe
 * with no photos on it. Now the sphere faces the photos.
 */
export function globeCenter(stats: PhotoStats): [number, number] {
  return [stats.center[0], stats.center[1]];
}
