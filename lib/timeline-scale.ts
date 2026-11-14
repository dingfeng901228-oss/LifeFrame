/**
 * Frank #0906 round-15: the timeline's time scale, extracted so the
 * landing page's feature-card mock-up uses the SAME mapping as the
 * real timeline.
 *
 * The problem it solves: the archive's photos are clustered in a
 * few years (1990, 2013, 2018-2026 for Frank) with two long empty
 * stretches in between. A linear 1990→now track therefore spent
 * two thirds of its length on years with no photos at all.
 *
 * The scale is piecewise:
 *   - BAND — a run of consecutive years that DO have photos. It gets
 *     a slice of the track proportional to its real duration, and
 *     time inside it stays linear (so the ±15 day window still
 *     means ±15 days).
 *   - GAP — the empty years between two bands. It gets a fixed
 *     sliver (GAP_YEARS) no matter how long it really is.
 */

export const MS_PER_DAY = 24 * 3600 * 1000;
export const MS_PER_YEAR = 365.25 * MS_PER_DAY;

/** How much of the track an empty year-range gets. */
export const GAP_YEARS = 0.5;

export type Segment = {
  kind: 'band' | 'gap';
  startMs: number;
  endMs: number;
  startPos: number;
  endPos: number;
};

export type Scale = {
  minDate: Date;
  maxDate: Date;
  segments: Segment[];
  /** 0..100 position of a date. */
  positionFor: (d: Date) => number;
  /** Date at a 0..100 position. */
  dateAt: (pos: number) => Date;
};

export type ScalePhoto = {
  taken_at?: string | null;
  created_at?: string | null;
};

export function photoDate(p: ScalePhoto): Date | null {
  const ts = p.taken_at || p.created_at;
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function linearScale(minDate: Date, maxDate: Date): Scale {
  const total = Math.max(1, maxDate.getTime() - minDate.getTime());
  return {
    minDate,
    maxDate,
    segments: [],
    positionFor: (d: Date) =>
      Math.max(
        0,
        Math.min(100, ((d.getTime() - minDate.getTime()) / total) * 100),
      ),
    dateAt: (pos: number) =>
      new Date(minDate.getTime() + (pos / 100) * total),
  };
}

export function buildScale(
  photos: ScalePhoto[],
  maxDate: Date,
): Scale {
  const yearSet = new Set<number>();
  for (const p of photos) {
    const d = photoDate(p);
    if (!d) continue;
    yearSet.add(d.getFullYear());
  }
  return buildScaleFromYears([...yearSet], maxDate);
}

/** Same scale, built from a plain list of years that have photos. */
export function buildScaleFromYears(
  yearsIn: number[],
  maxDate: Date,
): Scale {
  const yearSet = new Set<number>(yearsIn);
  let firstYear = Infinity;
  let lastYear = -Infinity;
  for (const y of yearSet) {
    if (y < firstYear) firstYear = y;
    if (y > lastYear) lastYear = y;
  }

  if (yearSet.size === 0) {
    // No photos: a plain 10-year window ending now.
    const minDate = new Date(maxDate.getTime() - 10 * MS_PER_YEAR);
    return linearScale(minDate, maxDate);
  }

  const years = [...yearSet].sort((a, b) => a - b);
  const minDate = new Date(firstYear, 0, 1);

  // Group consecutive photo years into bands.
  const bands: Array<{ startYear: number; endYear: number }> = [];
  for (const y of years) {
    const last = bands[bands.length - 1];
    if (last && y === last.endYear + 1) last.endYear = y;
    else bands.push({ startYear: y, endYear: y });
  }

  const bandStart = (b: { startYear: number; endYear: number }) =>
    b.startYear === bands[0].startYear
      ? minDate.getTime()
      : new Date(b.startYear, 0, 1).getTime();
  const bandEnd = (b: { startYear: number; endYear: number }) =>
    b.endYear === bands[bands.length - 1].endYear
      ? maxDate.getTime()
      : new Date(b.endYear, 11, 31, 23, 59, 59, 999).getTime();

  const bandWeights = bands.map((b) =>
    Math.max(0.001, (bandEnd(b) - bandStart(b)) / MS_PER_YEAR),
  );
  const totalWeight =
    bandWeights.reduce((a, b) => a + b, 0) + (bands.length - 1) * GAP_YEARS;

  const segments: Segment[] = [];
  let cursor = 0;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    const width = (bandWeights[i] / totalWeight) * 100;
    segments.push({
      kind: 'band',
      startMs: bandStart(b),
      endMs: bandEnd(b),
      startPos: cursor,
      endPos: cursor + width,
    });
    cursor += width;
    if (i < bands.length - 1) {
      const gapWidth = (GAP_YEARS / totalWeight) * 100;
      segments.push({
        kind: 'gap',
        startMs: bandEnd(b),
        endMs: bandStart(bands[i + 1]),
        startPos: cursor,
        endPos: cursor + gapWidth,
      });
      cursor += gapWidth;
    }
  }

  const positionFor = (d: Date) => {
    const ms = d.getTime();
    for (const seg of segments) {
      if (ms >= seg.startMs && ms <= seg.endMs) {
        const span = seg.endMs - seg.startMs;
        const ratio = span <= 0 ? 0 : (ms - seg.startMs) / span;
        return seg.startPos + ratio * (seg.endPos - seg.startPos);
      }
    }
    if (ms < segments[0].startMs) return 0;
    return 100;
  };

  const dateAt = (pos: number) => {
    const p = Math.max(0, Math.min(100, pos));
    for (const seg of segments) {
      if (p >= seg.startPos && p <= seg.endPos) {
        const span = seg.endPos - seg.startPos;
        const ratio = span <= 0 ? 0 : (p - seg.startPos) / span;
        return new Date(seg.startMs + ratio * (seg.endMs - seg.startMs));
      }
    }
    return p < 0
      ? new Date(segments[0].startMs)
      : new Date(segments[segments.length - 1].endMs);
  };

  return { minDate, maxDate, segments, positionFor, dateAt };
}
