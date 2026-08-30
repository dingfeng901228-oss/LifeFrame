'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  geoOrthographic,
  geoPath,
} from 'd3-geo';
import type { Feature, Geometry } from 'geojson';
import countriesGeo from '@/lib/countries';

export type GlobeMarker = {
  location: [number, number];
};

type Props = {
  markers?: GlobeMarker[];
  onMarkerSelect?: (index: number) => void;
  // Called when the user clicks a multi-photo cluster. The argument
  // is the list of marker indices that fall inside the cluster
  // (in the same order as `markers`). The parent maps these to actual
  // Photo rows and shows them in whatever modal/grid it likes.
  onClusterClick?: (indices: number[]) => void;
};

// Scale bounds. The lower bound is set so the ocean + countries
// always fill the visible area; the upper bound lets the user zoom
// deep enough to see a single country's borders in detail.
const MIN_SCALE = 220;
const MAX_SCALE = 2400;
// Angular rotation per second when autorotating.
const ROTATE_DEG_PER_SEC = 3.6;
// Drag sensitivity in degrees per pixel of pointer movement.
const DRAG_SENSITIVITY = 0.32;

type Size = { w: number; h: number };

/**
 * Fullscreen orthographic globe.
 *
 * The wrapper fills its parent (100% × 100%) so the globe can take
 * the whole viewport. The SVG viewBox is centered on (0, 0) and
 * matches the wrapper's pixel dimensions; a black <rect> fills the
 * corners outside the ocean circle, which is what the user sees
 * when the screen isn't square. The ocean circle's radius tracks
 * the d3-geo projection scale so countries and the ocean zoom
 * together — the previous version had a fixed ocean radius which
 * meant the sphere "grew" past its outline when you scrolled in.
 */
function GlobeImpl({ markers = [], onMarkerSelect, onClusterClick }: Props = {}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 800, h: 800 });
  const [rotation, setRotation] =
    useState<[number, number]>([0, -22]);
  const [scale, setScale] = useState(360);
  const [autoRotate, setAutoRotate] = useState(true);

  const dragRef = useRef<{
    x: number;
    y: number;
    rot: [number, number];
  } | null>(null);
  // Tracks whether the pointer moved enough between pointerdown and
  // pointerup to count as a drag (vs. a click). Used by the up
  // handler to decide between "pause because user dragged" and
  // "toggle because user just clicked on empty globe area".
  const movedRef = useRef(false);

  // ── Track wrapper size ─────────────────────────────────────────
  // Now that the wrapper is full-bleed, the SVG and viewBox need
  // both dimensions. The smaller of the two is also the natural
  // cap on the ocean radius (a circular sphere can't be wider
  // than the smaller viewport axis).
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize({ w, h });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Initial scale matches the smaller viewport axis so the globe
  //    fills that axis on first paint. When the user zooms in, the
  //    scale increases; when the window resizes, the next measure
  //    doesn't auto-rescale (the user's chosen zoom is preserved).
  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    const minDim = Math.min(size.w, size.h);
    const initialScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, minDim * 0.46));
    setScale(initialScale);
    // We only want to set this once per layout, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w === 0 && size.h === 0]);

  // ── Auto-rotation via requestAnimationFrame ─────────────────────
  useEffect(() => {
    if (!autoRotate) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dtSec = (now - last) / 1000;
      last = now;
      setRotation(([lambda, phi]) => {
        let nl = (lambda + ROTATE_DEG_PER_SEC * dtSec) % 360;
        if (nl > 180) nl -= 360;
        if (nl < -180) nl += 360;
        return [nl, phi];
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate]);

  // ── Projection + path generator ─────────────────────────────────
  const projection = useMemo(() => {
    return geoOrthographic()
      .rotate(rotation)
      .scale(scale)
      .translate([0, 0])
      .clipAngle(90)
      .precision(0.5);
  }, [rotation, scale]);

  const pathFn = useMemo(() => geoPath(projection), [projection]);

  const countryPaths = useMemo(() => {
    const out: { id: string | number; d: string }[] = [];
    countriesGeo.features.forEach((f: Feature<Geometry, any>, i: number) => {
      const d = pathFn(f as any);
      if (d) out.push({ id: (f.id as string | number | undefined) ?? i, d });
    });
    return out;
  }, [pathFn]);

  // ── Projected photo markers (drop ones on the back hemisphere) ──
  const projectedMarkers = useMemo(() => {
    const out: { i: number; x: number; y: number }[] = [];
    for (let i = 0; i < markers.length; i++) {
      const [lat, lng] = markers[i].location;
      const xy = projection([lng, lat]);
      if (xy) out.push({ i, x: xy[0], y: xy[1] });
    }
    return out;
  }, [markers, projection]);

  // ── Cluster by screen-space proximity (§5.3 of 要件定義書) ───
  // At low zoom, markers compress toward each other on screen, so
  // anything within ~28px of another marker merges into a cluster.
  // As the user zooms in (or clicks a cluster to zoom), markers
  // spread out and clusters split. Single-marker clusters render as
  // individual dots; multi-marker clusters render as a circle with a
  // count. Threshold is in screen px, not degrees — it works
  // across the full zoom range because the projection is pixel-based.
  const CLUSTER_PX = 28;
  const clusters = useMemo(() => {
    const used = new Set<number>();
    const out: Array<{
      i: number;
      cx: number;
      cy: number;
      count: number;
      indices: number[];
    }> = [];
    const thresholdSq = CLUSTER_PX * CLUSTER_PX;
    for (const seed of projectedMarkers) {
      if (used.has(seed.i)) continue;
      const group: number[] = [seed.i];
      used.add(seed.i);
      let cx = seed.x;
      let cy = seed.y;
      for (const other of projectedMarkers) {
        if (used.has(other.i)) continue;
        const dx = other.x - seed.x;
        const dy = other.y - seed.y;
        if (dx * dx + dy * dy < thresholdSq) {
          group.push(other.i);
          used.add(other.i);
          cx += other.x;
          cy += other.y;
        }
      }
      out.push({
        i: seed.i,
        cx: cx / group.length,
        cy: cy / group.length,
        count: group.length,
        indices: group,
      });
    }
    return out;
  }, [projectedMarkers]);

  // Cluster click — we no longer auto-zoom on cluster click, because
  // that hid the photos behind a generic "3" badge. Instead we hand
  // the cluster's marker indices to the parent via onClusterClick, and
  // the parent opens a modal listing the photos. Auto-zoom still works
  // via mouse wheel and (eventually) pinch gesture, just not on click.
  const handleClusterClick = useCallback(
    (indices: number[]) => {
      onClusterClick?.(indices);
    },
    [onClusterClick],
  );

  // ── Drag handling (pointer events for unified mouse/touch) ─────
  // Window-level pointermove/pointerup listeners are attached on
  // pointerdown so drag keeps working even when the pointer leaves
  // the wrapper (e.g. touch dragged off-screen). This replaces the
  // previous setPointerCapture approach — setPointerCapture redirects
  // click events to the capture target (per Pointer Events spec), which
  // silently broke marker onClick. Without it, clicks fire on the
  // original target (the marker <g>) and the photo detail modal opens.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        rot: [...rotation],
      };
      movedRef.current = false;
      // Don't pause on pointerdown — the up handler decides based
      // on whether the user dragged (→ pause) or just clicked
      // (→ toggle). The pause/continue button was removed in #6983
      // so the empty-globe click is now the only way to resume.
      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp, {
        once: true,
      });
      window.addEventListener('pointercancel', handleWindowPointerUp, {
        once: true,
      });
    },
    [rotation],
  );

  const handleWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // Anything beyond a small threshold (3px) counts as a drag
      // rather than a click — needed so the up handler can decide
      // pause-vs-toggle.
      if (!movedRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        movedRef.current = true;
      }
      let lambda = (d.rot[0] + dx * DRAG_SENSITIVITY) % 360;
      if (lambda > 180) lambda -= 360;
      if (lambda < -180) lambda += 360;
      const phi = Math.max(-90, Math.min(90, d.rot[1] - dy * DRAG_SENSITIVITY));
      setRotation([lambda, phi]);
    },
    [],
  );

  const handleWindowPointerUp = useCallback(() => {
    // If the pointer didn't move between down and up, treat it as a
    // click on the empty globe area → toggle auto-rotate. If it did
    // move, the user was dragging → leave the globe paused (the
    // setAutoRotate(false) call would have been issued the first
    // time, but we can just toggle false again — no harm).
    if (movedRef.current) {
      setAutoRotate(false);
    } else {
      setAutoRotate((v) => !v);
    }
    dragRef.current = null;
    movedRef.current = false;
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerUp);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, []);

  // ── Wheel zoom ──────────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * factor)));
  }, []);

  // The ocean radius follows the projection scale so the visible
  // "globe" stays in sync with the country outlines. We render a
  // thin gap (2px) at the outline so the radial gradient on the
  // ocean doesn't show through the SVG's circle stroke.
  const oceanRadius = Math.max(0, scale - 2);
  const svgWidth = size.w;
  const svgHeight = size.h;

  return (
    <div className="relative h-full w-full select-none">
      <div
        ref={wrapperRef}
        className="relative h-full w-full"
        style={{
          touchAction: 'none',
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`${-svgWidth / 2} ${-svgHeight / 2} ${svgWidth} ${svgHeight}`}
          style={{ display: 'block', overflow: 'visible' }}
          // Frank #7243 Task 8 (B4): treat the globe as decorative.
          // It's a backdrop for the photo markers (which have their
          // own button roles + aria-labels), not an interactive
          // element in itself. Without aria-hidden, a screen reader
          // would try to announce 200+ countries as `<title>`-less
          // `<path>` children. focusable="false" prevents IE/legacy
          // browsers from tabbing into the SVG.
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <radialGradient id="oceanGrad" cx="38%" cy="35%" r="75%">
              <stop offset="0%" stopColor="var(--ocean-light)" />
              <stop offset="65%" stopColor="var(--ocean-mid)" />
              <stop offset="100%" stopColor="var(--ocean-dark)" />
            </radialGradient>
          </defs>

          {/* Dark backdrop — fills the rectangular SVG outside the
              circular ocean. The previous version had a circular
              wrapper with overflow-hidden, so the user only ever
              saw the ocean; here the corners are visible and need
              to be a deliberate color, not whatever's behind the
              page. Color comes from --bg-primary in globals.css. */}
          <rect
            x={-svgWidth / 2}
            y={-svgHeight / 2}
            width={svgWidth}
            height={svgHeight}
            fill="var(--bg-primary)"
          />

          {/* Ocean / sphere */}
          <circle
            r={oceanRadius}
            fill="url(#oceanGrad)"
            stroke="var(--ocean-rim)"
            strokeWidth={1}
          />

          {/* Country borders & land */}
          <g>
            {countryPaths.map((c) => (
              <path
                key={c.id}
                d={c.d}
                fill="var(--country-fill)"
                stroke="var(--country-stroke)"
                strokeWidth={0.6}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {/* Photo markers — clusters or individuals, depending on count.
              Single-marker clusters render as the legacy cyan dot;
              multi-marker clusters render as a bigger circle with a
              count label, and clicking zooms in instead of opening
              the detail modal. */}
          <g>
            {clusters.map((c) => {
              if (c.count === 1) {
                return (
                  <g
                    key={`m-${c.i}`}
                    transform={`translate(${c.cx}, ${c.cy})`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onMarkerSelect?.(c.i)}
                    onMouseEnter={(e) => {
                      const target = e.currentTarget;
                      target.setAttribute('data-hover', '1');
                    }}
                  >
                    <circle r={18} fill="transparent" pointerEvents="all" />
                    <circle
                      r={9}
                      fill="var(--accent-soft)"
                      stroke="var(--marker-stroke)"
                      strokeWidth={1}
                      pointerEvents="none"
                    />
                    <circle
                      r={3.5}
                      fill="var(--marker-fill)"
                      pointerEvents="none"
                    />
                  </g>
                );
              }
              // Multi-marker cluster
              const r = Math.min(14 + c.count * 1.5, 36);
              return (
                <g
                  key={`c-${c.i}`}
                  transform={`translate(${c.cx}, ${c.cy})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleClusterClick(c.indices)}
                >
                  {/* Outer halo for affordance */}
                  <circle
                    r={r + 6}
                    fill="var(--accent-soft)"
                    pointerEvents="all"
                  />
                  {/* Cluster body */}
                  <circle
                    r={r}
                    fill="var(--accent)"
                    fillOpacity="0.45"
                    stroke="var(--marker-stroke)"
                    strokeOpacity="0.9"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                  {/* Count label */}
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fontSize={Math.min(11 + Math.log10(c.count) * 6, 18)}
                    fontWeight="bold"
                    fill="var(--bg-primary)"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {c.count}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2" />
    </div>
  );
}

// Wrap with React.memo so the parent re-rendering every animation
// tick (Time Travel drives selectedDate 5x/sec, which changes
// markers) does NOT force Globe to re-render unless its props
// actually changed. Markers reference is stable across ticks when
// the visible photo set is unchanged (HomeGallery uses useMemo
// over visiblePhotos); handlers must be useCallback'd in the
// parent for the shallow-compare skip to actually fire.
export const Globe = memo(GlobeImpl);