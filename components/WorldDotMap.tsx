'use client';

import { useMemo, useState } from 'react';
import { getCountryCentroid } from '@/lib/country-centroids';
import countriesGeo from '@/lib/countries';
import { expandCountryCard } from '@/components/CollapseCountryButton';

/**
 * Frank #0906 round-14 cont.: mini equirectangular world map
 * for the Stats page. Lightweight — pure inline SVG (no external
 * map lib), dark-mode aware.
 *
 * Layout: 360×180 viewBox (1:0.5 aspect, matches the
 * equirectangular 2:1 projection). Lat/lng → x/y: x = lng+180,
 * y = 90-lat.
 *
 * Frank #0906 round-14 cont.: the country outlines are now
 * real polygons from world-atlas 110m TopoJSON (177 countries,
 * ~95KB JSON → ~5KB projected SVG path data), not hand-traced
 * blobs. Visitor can actually point at Japan vs. Europe vs.
 * the Americas instead of guessing.
 *
 * Dots are sized by photo count: <5 → 3 px, <20 → 5 px, else
 * 7 px. Clicking a dot dispatches an event the cards listen
 * for (expandCountryCard + scrollIntoView).
 */
type Country = { country: string; total: number; cities: Array<{ city: string; count: number }> };

type Props = {
  countries: Country[];
  // onSelect was removed (Frank #0906 round-14): server
  // components can't pass functions into client components. The
  // dot click already dispatches the expand-country custom event
  // via expandCountryCard() below — the card itself handles
  // the scrollIntoView via the CollapseCountryButton listener.
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

/** Project a single GeoJSON Polygon or MultiPolygon ring to an
 *  SVG `d` string in the 360×180 viewBox. Equirectangular:
 *  each [lng, lat] → (lng+180, 90-lat). For MultiPolygon we
 *  emit one `M…L…Z` sub-path per part so countries with
 *  overseas territories (e.g. France, USA) don't get a giant
 *  diagonal line drawn between Hawaii and the mainland. */
function projectRing(ring: Array<[number, number, number?]>): string {
  return ring
    .map(([lng, lat]) => {
      const x = lng + 180;
      const y = 90 - lat;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' L ');
}

function projectGeometry(geom: GeoJSON.Geometry): string {
  if (geom.type === 'Polygon') {
    return geom.coordinates
      .map((ring) => 'M ' + projectRing(ring as [number, number, number?][]) + ' Z')
      .join(' ');
  }
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates
      .flatMap(
        (poly) =>
          poly.map(
            (ring) =>
              'M ' + projectRing(ring as [number, number, number?][]) + ' Z',
          ),
      )
      .join(' ');
  }
  return '';
}

export function WorldDotMap({ countries }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const placed = useMemo(
    () =>
      countries
        .map((c) => {
          // getCountryCentroid returns null for countries not
          // in the dict; the dot map shouldn't place a dot at
          // (0,0) for an unknown country. Skip such entries.
          const centroid = getCountryCentroid(c.country);
          if (!centroid) return null;
          const { x, y } = lngLatToXY(centroid.lat, centroid.lng);
          return { ...c, x, y };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [countries],
  );

  // Pre-compute country polygon paths. countriesGeo is the
  // module-level FeatureCollection from lib/countries (parsed
  // once at import time) so the projection loop only needs to
  // run once across the whole app lifetime.
  const countryPaths = useMemo(() => {
    const paths: { id: string; d: string }[] = [];
    for (const f of countriesGeo.features) {
      const d = projectGeometry(f.geometry);
      if (d) {
        // f.id is the numeric ISO code (e.g. 156 = China) in
        // the world-atlas 110m set. Use it as a stable key.
        paths.push({ id: String(f.id ?? f.properties?.name ?? ''), d });
      }
    }
    return paths;
  }, []);

  return (
    <div className="relative rounded-lg border border-white/10 bg-gradient-to-b from-sky-900/20 to-black/40">
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

        {/* Country polygons from world-atlas 110m (round-14
            cont.). Single flat-fill so the visitor can recognize
            continents at a glance. ~95KB JSON → ~5KB of SVG
            path data after projection + 2-decimal rounding. */}
        <g
          className="fill-white/[0.07] stroke-white/15"
          strokeWidth="0.4"
          strokeLinejoin="round"
        >
          {countryPaths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              className="transition-opacity duration-150"
            />
          ))}
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
                data-stats-country={c.country}
                className="fill-cyan-500 stroke-white dark:fill-cyan-400 dark:stroke-black transition-opacity duration-150"
                strokeWidth="0.5"
                onMouseEnter={() => setHovered(c.country)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => expandCountryCard(c.country)}
                style={{ cursor: 'pointer' }}
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
                  className="fill-white pointer-events-none"
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
          <span className="text-white/40">
            ({countries.length - placed.length} 国家未在此地图展示)
          </span>
        )}
      </div>
    </div>
  );
}