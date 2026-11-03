// Frank #7243 round-6: unified search helpers.
//
// Borrowed from OldMapsOnline / TimeMap, whose Dec 2025 release
// shipped "更智能、更简洁的历史搜索": one query returns every
// entity type at once (battles, regions, rulers, notable people)
// instead of forcing you into separate per-type searches.
//
// LifeFrame's search only matched photos. This module adds the
// other two axes a photo archive actually has:
//
//   places — the distinct locations in the archive
//   times  — years / months / month-days that hold photos
//
// Everything here is pure so it can be unit-tested without a
// browser.

export type PlaceHit = {
  /** The location name as stored on the photo. */
  name: string;
  /** How many photos carry this location. */
  count: number;
};

export type TimeHit = {
  /** What the query resolved to. */
  kind: 'year' | 'month' | 'monthday';
  /** Human label, e.g. "2020 年 3 月" or "每年 3 月 29 日". */
  label: string;
  /** The date to jump to. */
  date: Date;
  /** How many photos fall in that bucket. */
  count: number;
};

export type SearchablePhoto = {
  filename: string;
  location_name: string | null;
  taken_at: string | null;
  created_at: string;
};

/** The date a photo belongs to, preferring the capture time. */
export function photoDate(p: SearchablePhoto): Date | null {
  const ts = p.taken_at || p.created_at;
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Distinct locations whose name contains the query.
 * Sorted by photo count (richest place first), then by name.
 */
export function matchPlaces(photos: SearchablePhoto[], query: string): PlaceHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const counts = new Map<string, number>();
  for (const p of photos) {
    const name = p.location_name?.trim();
    if (!name) continue;
    if (!name.toLowerCase().includes(q)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Parse a date-like query into its parts.
 *
 * Supported: 2020 · 2020-03 · 2020/3 · 2020年3月 · 2020-03-29 ·
 * 2020年3月29日 · 3-29 · 3月29日 · 1013 (MMDD) · 3月
 *
 * A hand-rolled parser rather than one big regex: the regex form
 * broke on "2020年3月" (the optional month group backtracked and
 * left the trailing 月 unconsumed) and on "1013" (the year branch
 * swallowed it and then rejected year 1013).
 */
type DateParts = { year?: number; month?: number; day?: number };

function parseDateQuery(raw: string): DateParts | null {
  const q = raw.trim();
  if (!q) return null;

  // CJK markers become separators; 日 is just a suffix.
  const hadMonthMarker = q.includes('月');
  const s = q.replace(/[年月]/g, '-').replace(/日/g, '');
  const parts = s.split(/[-/.\s]+/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,4}$/.test(p)) return null;
    nums.push(Number(p));
  }

  if (nums.length === 1) {
    const n = nums[0];
    if (n >= 1900 && n <= 2100) return { year: n };
    // Four digits without a separator read as MMDD.
    if (n >= 100 && n <= 1231) {
      return { month: Math.floor(n / 100), day: n % 100 };
    }
    // A lone "3月" means the month, across every year.
    if (hadMonthMarker && n >= 1 && n <= 12) return { month: n };
    return null;
  }

  if (nums.length === 2) {
    if (nums[0] >= 1900 && nums[0] <= 2100) {
      return { year: nums[0], month: nums[1] };
    }
    return { month: nums[0], day: nums[1] };
  }

  if (nums.length === 3) {
    return { year: nums[0], month: nums[1], day: nums[2] };
  }

  return null;
}

/**
 * Resolve a date-like query into the time buckets that hold
 * photos.
 *
 * - "2020"        → the year 2020
 * - "2020-03"     → March 2020
 * - "2020-03-29"  → 29 March 2020
 * - "3-29"        → 29 March in every year that has one
 *
 * Returns [] when the query isn't date-like or matches nothing —
 * the caller then shows only photo results.
 */
export function matchTimes(photos: SearchablePhoto[], query: string): TimeHit[] {
  const q = query.trim();
  if (!q) return [];

  const dates: Date[] = [];
  for (const p of photos) {
    const d = photoDate(p);
    if (d) dates.push(d);
  }
  if (dates.length === 0) return [];

  const parts = parseDateQuery(q);
  if (!parts) return [];

  const { year, month, day } = parts;
  if (year !== undefined && (year < 1900 || year > 2100)) return [];
  if (month !== undefined && (month < 1 || month > 12)) return [];
  if (day !== undefined && (day < 1 || day > 31)) return [];

  const hits = dates.filter((d) => {
    if (year !== undefined && d.getFullYear() !== year) return false;
    if (month !== undefined && d.getMonth() + 1 !== month) return false;
    if (day !== undefined && d.getDate() !== day) return false;
    return true;
  });
  if (hits.length === 0) return [];

  // Year + month + day → one specific day.
  if (year !== undefined && month !== undefined && day !== undefined) {
    return [
      {
        kind: 'monthday',
        label: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`,
        date: new Date(year, month - 1, day),
        count: hits.length,
      },
    ];
  }

  // Year + month → that month.
  if (year !== undefined && month !== undefined) {
    return [
      {
        kind: 'month',
        label: `${year} 年 ${month} 月`,
        date: new Date(year, month - 1, 1),
        count: hits.length,
      },
    ];
  }

  // Year → that year.
  if (year !== undefined) {
    return [
      { kind: 'year', label: `${year} 年`, date: new Date(year, 0, 1), count: hits.length },
    ];
  }

  // Month + day (or a lone month) → every year that has one; land
  // on the most recent occurrence.
  const latest = hits.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  if (month === undefined) return [];
  if (day !== undefined) {
    return [
      {
        kind: 'monthday',
        label: `每年 ${month} 月 ${day} 日`,
        date: new Date(latest.getFullYear(), month - 1, day),
        count: hits.length,
      },
    ];
  }
  return [
    {
      kind: 'month',
      label: `每年 ${month} 月`,
      date: new Date(latest.getFullYear(), month - 1, 1),
      count: hits.length,
    },
  ];
}

/**
 * The distinct locations visited within `windowDays` of the photos
 * in `placePhotos`, excluding the place itself.
 *
 * This is LifeFrame's take on TimeMap's "Unlock the Entire Story"
 * — the panel shows the rulers, conflicts and contemporaries of the
 * period you selected. Here the contemporaries are the OTHER
 * places you were in around the same time.
 */
export function matchContemporaries(
  allPhotos: SearchablePhoto[],
  placePhotos: SearchablePhoto[],
  windowDays = 45,
): PlaceHit[] {
  if (placePhotos.length === 0) return [];
  const dates = placePhotos.map(photoDate).filter((d): d is Date => d !== null);
  if (dates.length === 0) return [];

  const min = Math.min(...dates.map((d) => d.getTime()));
  const max = Math.max(...dates.map((d) => d.getTime()));
  const span = windowDays * 86400000;
  const from = min - span;
  const to = max + span;

  const placeNames = new Set(
    placePhotos.map((p) => p.location_name?.trim()).filter(Boolean) as string[],
  );

  const counts = new Map<string, number>();
  for (const p of allPhotos) {
    const name = p.location_name?.trim();
    if (!name || placeNames.has(name)) continue;
    const d = photoDate(p);
    if (!d) continue;
    const t = d.getTime();
    if (t < from || t > to) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 6);
}
