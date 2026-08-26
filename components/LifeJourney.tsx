'use client';

import { useEffect, useMemo } from 'react';

// Minimal subset of PhotoRow we need. Keeps the component
// independent of the Supabase schema shape used by HomeGallery.
type JourneyPhoto = {
  taken_at: string | null;
  created_at: string;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
};

type Props = {
  photos: JourneyPhoto[];
  open: boolean;
  onClose: () => void;
  // Called when the user clicks an entry. Parent uses this to
  // set selectedDate so Globe + Timeline sync to that period.
  onSelectEntry?: (entry: JourneyEntry) => void;
};

export type JourneyEntry = {
  location: string; // full "City, Country" string as stored
  city: string;
  country: string;
  startDate: Date;
  endDate: Date;
  photoCount: number;
  lat: number;
  lng: number;
};

type CountryGroup = {
  country: string;
  cities: JourneyEntry[];
};

const MONTH_PAD = (n: number) => String(n + 1).padStart(2, '0');

// Parse "Tokyo, Japan" → { city: "Tokyo", country: "Japan" }.
// Nominatim-style "Tokyo, Japan" or "Yokohama, Kanagawa, Japan"
// (city, region, country). We treat the last segment as country
// and the first as city — middle segments are folded into city
// ("Kanagawa, Japan" stays city="Kanagawa").
function splitLocation(loc: string): { city: string; country: string } {
  const parts = loc
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: 'Unknown', country: 'Unknown' };
  if (parts.length === 1) return { city: parts[0], country: 'Unknown' };
  return { city: parts[0], country: parts[parts.length - 1] };
}

// Group consecutive photos at the same location_name into one
// entry. A "new entry" starts whenever the location string changes
// while walking chronologically. This mirrors how Frank travels:
// "I was in Tokyo for 3 years, then moved to Yokohama for 1 year".
// Long gaps to the same location produce separate entries, which
// is intentional — re-visits are meaningful for a life journey.
function buildEntries(photos: JourneyPhoto[]): JourneyEntry[] {
  const sorted = photos
    .filter((p) => p.location_name)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.taken_at || a.created_at).getTime();
      const tb = new Date(b.taken_at || b.created_at).getTime();
      return ta - tb;
    });

  const entries: JourneyEntry[] = [];
  let current: JourneyEntry | null = null;

  for (const p of sorted) {
    const loc = p.location_name || 'Unknown';
    const date = new Date(p.taken_at || p.created_at);
    if (!Number.isFinite(date.getTime())) continue;
    const { city, country } = splitLocation(loc);

    if (current && current.location === loc) {
      if (date.getTime() > current.endDate.getTime()) current.endDate = date;
      current.photoCount += 1;
      // Keep the most recent lat/lng observed for this location
      if (p.lat != null && p.lng != null) {
        current.lat = p.lat;
        current.lng = p.lng;
      }
    } else {
      if (current) entries.push(current);
      current = {
        location: loc,
        city,
        country,
        startDate: date,
        endDate: date,
        photoCount: 1,
        lat: p.lat ?? 0,
        lng: p.lng ?? 0,
      };
    }
  }
  if (current) entries.push(current);
  return entries;
}

function groupByCountry(entries: JourneyEntry[]): CountryGroup[] {
  const map = new Map<string, JourneyEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.country) ?? [];
    arr.push(e);
    map.set(e.country, arr);
  }
  return [...map.entries()].map(([country, cities]) => ({
    country,
    cities,
  }));
}

function formatYearMonth(d: Date): string {
  return `${d.getFullYear()}.${MONTH_PAD(d.getMonth())}`;
}

function formatYearRange(start: Date, end: Date): string {
  if (start.getTime() === end.getTime()) return formatYearMonth(start);
  // Different years → show year range; same year → show month range.
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getFullYear()} – ${end.getFullYear()}`;
  }
  return `${formatYearMonth(start)} – ${formatYearMonth(end)}`;
}

export function LifeJourney({ photos, open, onClose, onSelectEntry }: Props) {
  const entries = useMemo(() => buildEntries(photos), [photos]);
  const groups = useMemo(() => groupByCountry(entries), [entries]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] overflow-auto bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-auto max-w-2xl px-6 py-16 sm:py-24"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-10 flex items-baseline justify-between">
          <div>
            <p className="text-xs tracking-[0.4em] text-white/40 uppercase">
              Life Journey
            </p>
            <h2 className="mt-3 text-3xl font-light text-white">
              🌏 人生足迹
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/20 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            ✕ 关闭 (ESC)
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="text-white/40">
            还没有带位置的照片 — 上传含 GPS 的照片后再看。
          </p>
        ) : (
          <div className="space-y-10">
            {groups.map((g) => (
              <section key={g.country}>
                <h3 className="mb-4 text-sm tracking-[0.3em] uppercase text-white/40">
                  📍 {g.country}
                </h3>
                <ol className="relative space-y-3 border-l-2 border-white/10 pl-6">
                  {g.cities.map((e, i) => (
                    <li key={`${e.location}-${i}`} className="relative">
                      <span className="absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full bg-cyan-400 text-xs font-medium text-black tabular-nums">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectEntry?.(e)}
                        className="block w-full rounded p-3 text-left transition hover:bg-white/5"
                      >
                        <div className="text-lg font-light text-white">
                          {e.city}
                        </div>
                        <div className="mt-1 text-xs tabular-nums text-white/40">
                          {formatYearRange(e.startDate, e.endDate)} ·{' '}
                          {e.photoCount} 张照片
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}