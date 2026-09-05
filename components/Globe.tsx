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
  // Phase 3 (SpatialExplorer wiring): fired when the user drags
  // (rotation changes) or zooms (scale changes). Phase 4 reads scale
  // from this stream to trigger the Globe → Map crossfade at
  // MAP_TRANSITION_BEGIN.
  onRotationChange?: (rotation: [number, number]) => void;
  onScaleChange?: (scale: number) => void;
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
function GlobeImpl({
  markers = [],
  onMarkerSelect,
  onClusterClick,
  onRotationChange,
  onScaleChange,
}: Props = {}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ w: 800, h: 800 });
  const [rotation, setRotation] =
    useState<[number, number]>([0, -22]);
  const [scale, setScale] = useState(360);
  const [autoRotate, setAutoRotate] = useState(true);

  // Stable refs for the rotation/scale callbacks so the watchers
  // below don't re-fire when SpatialExplorer passes fresh function
  // refs each render.
  const onRotationChangeRef = useRef(onRotationChange);
  onRotationChangeRef.current = onRotationChange;
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;

  // Phase 3: stream Globe state up to SpatialExplorer. Phase 4 reads
  // `scale` from this stream to trigger the crossfade at
  // MAP_TRANSITION_BEGIN.
  useEffect(() => {
    onRotationChangeRef.current?.(rotation);
  }, [rotation]);
  useEffect(() => {
    onScaleChangeRef.current?.(scale);
  }, [scale]);

  // MapLibre second-round bug fix (Frank #7914): track all active
  // pointers so 2-finger pinch (mobile) can compute distance
  // ratio and dispatch scale changes instead of triggering two
  // single-finger drags that jitter rotation.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  // Pinch state — set when a second pointer goes down. null while
  // only one (or zero) pointer is active. Records the distance +
  // scale at pinch-start so each pointermove can compute the
  // ratio against the static initial frame (avoids drift on
  // long-running pinches).
  const pinchStateRef = useRef<{
    initialDistance: number;
    initialScale: number;
  } | null>(null);
  // Single-finger drag — preserves the existing #6980/#6983 UX
  // (drag rotates; click on empty globe toggles auto-rotate).
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

  // ── Drag + pinch handling (pointer events for unified mouse/touch) ─
  // Window-level pointermove/pointerup listeners are attached on
  // pointerdown so drag keeps working even when the pointer leaves
  // the wrapper (e.g. touch dragged off-screen). This replaces the
  // previous setPointerCapture approach — setPointerCapture redirects
  // click events to the capture target (per Pointer Events spec), which
  // silently broke marker onClick. Without it, clicks fire on the
  // original target (the marker <g>) and the photo detail modal opens.
  //
  // MapLibre second-round fix (Frank #7914): also tracks multi-touch
  // via activePointersRef + pinchStateRef. Two simultaneous pointers
  // switch from drag-rotation to pinch-scale (distance ratio).
  // Three+ pointers are ignored (no extra gesture). When one of two
  // pinch pointers lifts, we resume single-finger drag with the
  // remaining pointer so the user can finish rotating without
  // lifting both fingers.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // Track this pointer regardless of count.
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      const count = activePointersRef.current.size;
      if (count === 1) {
        // Single-finger drag — preserve existing #6980/#6983 UX.
        dragRef.current = {
          x: e.clientX,
          y: e.clientY,
          rot: [...rotation],
        };
        movedRef.current = false;
        pinchStateRef.current = null;
      } else if (count === 2) {
        // Enter pinch mode — record initial distance + scale.
        const pts = Array.from(activePointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const initialDistance = Math.hypot(dx, dy);
        if (initialDistance > 0) {
          pinchStateRef.current = {
            initialDistance,
            initialScale: scale,
          };
        }
        // Drop drag — once two fingers are down, the user is
        // pinching, not rotating. Don't apply further rotation
        // changes from the second pointer's movements.
        dragRef.current = null;
        movedRef.current = false;
      } else {
        // 3+ pointers — ignore extras. Stay in pinch (or drag)
        // mode driven by the first two.
      }

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
    [rotation, scale],
  );

  const handleWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      // Always update the active-pointer set so pinch can compute
      // the live distance between the two tracked fingers.
      if (activePointersRef.current.has(e.pointerId)) {
        activePointersRef.current.set(e.pointerId, {
          x: e.clientX,
          y: e.clientY,
        });
      }

      // Pinch mode — 2 active pointers. Compute new distance,
      // derive scale ratio against initialDistance, clamp to
      // MIN_SCALE / MAX_SCALE so the same threshold that triggers
      // the Globe → Map transition also applies to pinch (per
      // Frank #7914: "Pinch zoom must use the same MIN_SCALE /
      // MAX_SCALE / transition threshold as Desktop wheel").
      const pinch = pinchStateRef.current;
      if (pinch && activePointersRef.current.size >= 2) {
        const pts = Array.from(activePointersRef.current.values()).slice(
          0,
          2,
        );
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const newDistance = Math.hypot(dx, dy);
        if (newDistance > 0 && pinch.initialDistance > 0) {
          const ratio = newDistance / pinch.initialDistance;
          const next = pinch.initialScale * ratio;
          const clamped = Math.max(
            MIN_SCALE,
            Math.min(MAX_SCALE, next),
          );
          setScale(clamped);
        }
        // Pinch mode does NOT touch rotation — per Frank #7914
        // "不要让双指 pinch 同时触发 Globe rotation".
        return;
      }

      // Single-finger drag — original logic.
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

  const handleWindowPointerUp = useCallback(
    (e: PointerEvent) => {
      // Remove this pointer from the active set.
      activePointersRef.current.delete(e.pointerId);
      const remaining = activePointersRef.current.size;

      // If we were pinching and one finger lifted, the remaining
      // finger should resume drag-mode from its current position
      // so the user can keep rotating without lifting both.
      if (remaining === 1 && pinchStateRef.current) {
        const last = Array.from(activePointersRef.current.entries())[0];
        pinchStateRef.current = null;
        if (last) {
          dragRef.current = {
            x: last[1].x,
            y: last[1].y,
            rot: [...rotation],
          };
          movedRef.current = true; // suppress click-toggle; we just finished a pinch
        }
      } else if (remaining === 0) {
        // Last finger up — finalize.
        if (movedRef.current) {
          setAutoRotate(false);
        } else {
          // Treat as a click on empty globe → toggle auto-rotate.
          // (Only meaningful in single-finger drag mode; pinch
          // exits with movedRef=true so the click-toggle branch
          // is naturally skipped.)
          setAutoRotate((v) => !v);
        }
        dragRef.current = null;
        movedRef.current = false;
        pinchStateRef.current = null;
      }

      // Only tear down window listeners when all pointers are
      // released; otherwise we keep them attached so the next
      // pointermove can still reach us.
      if (remaining === 0) {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
        window.removeEventListener('pointercancel', handleWindowPointerUp);
      }
    },
    [rotation],
  );

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