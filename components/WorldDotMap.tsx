'use client';

import { useMemo, useState } from 'react';
import { COUNTRY_CENTROIDS } from '@/lib/country-centroids';
import { expandCountryCard } from '@/components/CollapseCountryButton';

/**
 * Frank #0906 round-14 (Batch C): mini equirectangular world map
 * for the Stats page. Lightweight — pure inline SVG (no external
 * map lib), dark-mode aware.
 *
 * Layout: 360×180 viewBox (1:0.5 aspect, matches Robinson-ish 2:1
 * equirectangular projection roughly). The whole map is one
 * stretched CSS pixel so it scales nicely inside the stats
 * container. Lat/lng → x/y: x = (lng+180)/360 * 360 = lng+180,
 * y = (90-lat)/180 * 180 = 90-lat.
 *
 * Dots are sized by photo count: <5 → 3 px, <20 → 5 px, else 7 px.
 * Clicking a dot expands a country card (defer to the parent).
 */
type Country = { country: string; total: number; cities: Array<{ city: string; count: number }> };

type Props = {
  countries: Country[];
  // When a dot is clicked we scroll to / highlight the matching
  // country card. The parent owns the anchor lookup (we just call
  // .scrollIntoView on the target ref).
  onSelect?: (id: string) => void;
};

const W = 360;
const H = 180;

function lngLatToXY(lat: number, lng: number): { x: number; y: number } {
  return {
    x: lng + 180,
    y: 90 - lat,
  };
}

function dotSize(count: number): number {
  if (count < 5) return 3;
  if (count < 20) return 5;
  return 7;
}

export function WorldDotMap({ countries, onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const placed = useMemo(
    () =>
      countries
        .map((c) => {
          const centroid = COUNTRY_CENTROIDS[c.country];
          if (!centroid) return null;
          const { x, y } = lngLatToXY(centroid.lat, centroid.lng);
          return { ...c, x, y };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [countries],
  );

  return (
    <div className="relative rounded-lg border border-black/10 bg-gradient-to-b from-sky-50/40 to-white dark:border-white/10 dark:from-sky-900/20 dark:to-black/40">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="World map showing visited countries"
      >
        {/* Equirectangular graticule (every 30° latitude / 60° longitude).
             Pure SVG so it scales perfectly with no asset weight. */}
        <defs>
          <pattern
            id="grat"
            width="60"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 60 0 L 0 0 0 30"
              fill="none"
              className="stroke-black/10 dark:stroke-white/10"
              strokeWidth="0.4"
            />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="url(#grat)" />

        {/* Hand-traced continental blobs. Not cartographic — just
             enough shape to anchor dots to a continent. Three
             stylised landmass groups so the dot grid feels
             purposeful instead of floating in space. */}
        <g
          className="fill-black/[0.06] stroke-black/15 dark:fill-white/[0.08] dark:stroke-white/20"
          strokeWidth="0.4"
        >
          {/* Asia / Pacific */}
          <path d="M210 36 Q230 28 260 32 Q300 32 325 50 Q340 60 340 90 Q330 110 310 115 Q280 122 250 110 Q220 102 210 80 Q198 60 210 36Z" />
          {/* Europe / Africa */}
          <path d="M150 38 Q170 28 200 32 Q220 38 220 60 Q230 80 218 110 Q200 140 185 145 Q170 138 165 115 Q150 95 150 75 Q145 55 150 38Z" />
          {/* Americas */}
          <path d="M40 38 Q60 28 80 32 Q100 40 105 60 Q110 90 95 110 Q85 130 75 145 Q60 140 50 115 Q35 90 40 60 Q35 48 40 38Z" />
          {/* Australia */}
          <path d="M280 125 Q300 118 320 125 Q330 135 320 148 Q300 152 285 145 Q275 138 280 125Z" />
        </g>

        {/* Country dots */}
        {placed.map((c) => {
          const r = dotSize(c.total);
          const isHover = hovered === c.country;
          return (
            <g key={c.country}>
              <circle
                cx={c.x}
                cy={c.y}
                r={r + (isHover ? 2 : 0)}
                className="fill-cyan-500/30 dark:fill-cyan-400/30"
                style={{ transition: 'r 120ms ease-out' }}
              />
              <circle
                cx={c.x}
                cy={c.y}
                r={r}
                className="fill-cyan-500 stroke-white dark:fill-cyan-400 dark:stroke-black"
                strokeWidth="0.5"
                onMouseEnter={() => setHovered(c.country)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  onSelect?.(c.country);
                  expandCountryCard(c.country);
                }}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <title>
                  {c.country}: {c.total} 张
                </title>
              </circle>
              {isHover && (
                <text
                  x={c.x}
                  y={c.y - r - 3}
                  textAnchor="middle"
                  fontSize="5"
                  className="fill-black dark:fill-white pointer-events-none"
                >
                  {c.country} · {c.total}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-black/60 dark:text-white/60">
        <span>● &lt;5 张</span>
        <span>● 5–19 张</span>
        <span>● 20+ 张</span>
        {placed.length < countries.length && (
          <span className="text-black/40 dark:text-white/40">
            ({countries.length - placed.length} 国家未在此地图展示)
          </span>
        )}
      </div>
    </div>
  );
}