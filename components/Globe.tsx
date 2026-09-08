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

  // Tracks whether the pointer moved enough between pointerdown and
  // pointerup to count as a drag (vs. a click). Used by the up
  // handler to decide between "pause because user dragged" and
  // "toggle because user just clicked on empty globe area".
  const movedRef = useRef(false);

  // ── Touch gesture state machine (修复 Mobile Globe「放大后无法旋转」Bug) ──
  // Single source of truth for the active touch gesture. Updated
  // synchronously in pointerdown / pointermove / pointerup so
  // the high-frequency events (60+ Hz on mobile) don't have to
  // wait for a React render to settle. Without this, after a
  // 2-finger pinch the user's remaining 1 finger would either
  // (a) inherit a stale drag baseline from the first finger and
  // spin the globe wildly on its first move, or (b) find
  // dragRef.current === null and silently no-op — the bug Frank
  // described as "pinch 之后单指拖动无法继续旋转 Globe".
  type TouchGesture = 'none' | 'rotate' | 'pinch';
  const gestureRef = useRef<TouchGesture>('none');
  // Single-finger rotation baseline: the {x,y} of the most recent
  // rotate-mode move. dx/dy in subsequent moves is computed
  // against this. Reset to null whenever we enter pinch or
  // when all fingers lift, and rebuilt on the first move of a
  // new rotate gesture.
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  // Pinch baseline: distance + scale captured when the gesture
  // transitioned into 'pinch'. Each subsequent move recomputes
  // currentDistance / initialDistance and applies that ratio to
  // initialScale. Cleared on every state transition out of pinch.
  const pinchRef = useRef<{
    initialDistance: number;
    initialScale: number;
  } | null>(null);
  // Live touch positions keyed by pointerId. We need an explicit
  // map (rather than `e.touches` on each event) because React's
  // pointer events normalize multi-touch as overlapping events
  // and we want to know the current set of all active fingers
  // at any instant, not just the one that triggered the latest
  // callback.
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );
  // Reference to the latest scale so the pinch handler can
  // compute nextScale from the actual current value rather
  // than chasing React's setState cycle. Mirrors the `scale`
  // state but is read-by-pointermove without going through
  // a closure.
  const globeScaleRef = useRef(scale);
  useEffect(() => {
    globeScaleRef.current = scale;
  }, [scale]);

  // Helper: reset all touch-gesture state. Called on
  // pointercancel and on transitions out of every multi-touch
  // state. The next pointerdown starts fresh.
  const resetTouchGesture = useCallback(() => {
    gestureRef.current = 'none';
    lastTouchRef.current = null;
    pinchRef.current = null;
  }, []);

  // Frank #0906 round-13: dev-only debug hook so the test
  // suite can inspect the current gesture state, scale, and
  // rotation without going through React DevTools. Stored
  // both on window and on the wrapper element so the test
  // can pick the right instance when multiple Globes are
  // mounted (desktop + mobile layout).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const debug = {
      get gesture() {
        return gestureRef.current;
      },
      get scale() {
        return globeScaleRef.current ?? scale;
      },
      get rotation() {
        return rotation;
      },
      get activeTouches() {
        return activeTouchesRef.current.size;
      },
    };
    (
      window as unknown as {
        __globeDebug?: typeof debug;
      }
    ).__globeDebug = debug;
    // Also expose on the wrapper DOM element so the test
    // can pick the specific Globe instance that the user
    // is interacting with.
    if (wrapperRef.current) {
      (
        wrapperRef.current as unknown as { __globeDebug?: typeof debug }
      ).__globeDebug = debug;
    }
  }, [scale, rotation]);

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

  // ── Projection + path generator ────────────────────────────────
  // Standard React useMemo: re-derives on rotation or scale
  // change. The pinch handler updates `scale` via setScale
  // and we observe it through this dep.
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
  // ── Pointer handling (修复 Mobile Globe「放大后无法旋转」Bug) ──
  // Replaces the previous single-pointer dragRef model. The
  // gesture state machine above (gestureRef / lastTouchRef /
  // pinchRef / activeTouchesRef) is the source of truth.
  //
  // Key invariant: a 2-finger → 1-finger transition (e.g. user
  // pinches to zoom in, then lifts the right finger to start
  // rotating with the left) MUST rebuild lastTouchRef on the
  // remaining finger, not inherit the pre-pinch baseline. The
  // "if the user lifts one finger of a 2-finger gesture, the
  // remaining 1 finger's first move produces a giant dx/dy"
  // bug is fixed here by re-seeding the baseline the moment
  // the second finger lifts (see handleWindowPointerUp).
  //
  // mouse button !== 0 still filters out middle/right clicks.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // Register this touch in the live map.
      activeTouchesRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
      const count = activeTouchesRef.current.size;
      if (count === 1) {
        // Single-finger drag — enter 'rotate' state and seed
        // the baseline. We intentionally do NOT use the
        // pre-pinch `dragRef` value (it stays null after our
        // refactor).
        gestureRef.current = 'rotate';
        lastTouchRef.current = { x: e.clientX, y: e.clientY };
        pinchRef.current = null;
        movedRef.current = false;
      } else if (count === 2) {
        // Second finger down → enter pinch. Capture distance
        // and current scale as the baseline.
        const pts = Array.from(activeTouchesRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const initialDistance = Math.hypot(dx, dy);
        if (initialDistance > 0) {
          gestureRef.current = 'pinch';
          pinchRef.current = {
            initialDistance,
            initialScale: globeScaleRef.current,
          };
          lastTouchRef.current = null;
        }
      } else {
        // 3+ fingers — ignore extras, stay in pinch.
      }

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp);
      window.addEventListener('pointercancel', handleWindowPointerUp);
    },
    // handleWindowPointerMove / handleWindowPointerUp are stable
    // refs — they're declared below but never recreated, so the
    // empty deps here is intentional. The handlers are picked up
    // on first paint via the `useEffect` block that adds them
    // on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Per-event move handler. Dispatches on the gesture state
  // machine: rotate uses lastTouchRef, pinch uses pinchRef.
  // Both clamp to the documented bounds (no max-scale → no
  // rotate, per the spec's §7 "scale 和 rotation 必须完全独立").
  const handleWindowPointerMove = useCallback((e: PointerEvent) => {
    // Update this finger's live position first so the gesture
    // router sees a consistent snapshot.
    if (activeTouchesRef.current.has(e.pointerId)) {
      activeTouchesRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
    }
    const count = activeTouchesRef.current.size;

    // Pinch path: 2+ active fingers + gesture === 'pinch'.
    // The scale and rotation are deliberately decoupled — even
    // at MAX_SCALE the user can still rotate, and the pinch
    // ratio does not touch rotation.
    if (gestureRef.current === 'pinch' && count >= 2) {
      const pinch = pinchRef.current;
      if (!pinch) {
        return;
      }
      const pts = Array.from(activeTouchesRef.current.values()).slice(
        0,
        2,
      );
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const currentDistance = Math.hypot(dx, dy);
      if (currentDistance <= 0 || pinch.initialDistance <= 0) return;
      const ratio = currentDistance / pinch.initialDistance;
      const base = globeScaleRef.current;
      const next = base * ratio;
      const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      globeScaleRef.current = clamped;
      setScale(clamped);
      return;
    }

    // Rotate path: 1 active finger + gesture === 'rotate'.
    if (gestureRef.current === 'rotate' && count === 1) {
      const last = lastTouchRef.current;
      if (!last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      if (!movedRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        movedRef.current = true;
      }
      setRotation(([lambda, phi]) => {
        let nl = (lambda + dx * DRAG_SENSITIVITY) % 360;
        if (nl > 180) nl -= 360;
        if (nl < -180) nl += 360;
        const np = Math.max(-90, Math.min(90, phi - dy * DRAG_SENSITIVITY));
        return [nl, np];
      });
      lastTouchRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
  }, []);

  const handleWindowPointerUp = useCallback(
    (e: PointerEvent) => {
      // Remove this finger from the live set BEFORE the gesture
      // transition decision so the count we read below is the
      // post-removal count.
      activeTouchesRef.current.delete(e.pointerId);
      const count = activeTouchesRef.current.size;

      if (count === 0) {
        // Last finger up — full reset.
        if (movedRef.current) {
          setAutoRotate(false);
        } else if (gestureRef.current === 'rotate') {
          // Empty-globe click: toggle auto-rotate. (We only
          // treat this as a click when the gesture was a single
          // rotate — a tap in a 2-finger gesture that was
          // never used to move shouldn't pause the globe.)
          setAutoRotate((v) => !v);
        }
        resetTouchGesture();
        movedRef.current = false;
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
        window.removeEventListener('pointercancel', handleWindowPointerUp);
        return;
      }

      if (count === 1 && gestureRef.current === 'pinch') {
        // 2-finger → 1-finger transition. Critical: rebuild
        // lastTouchRef on the remaining finger so its first
        // move doesn't produce a giant dx/dy. Also clear
        // pinchRef so the next move doesn't accidentally run
        // the pinch branch.
        gestureRef.current = 'rotate';
        const remaining = Array.from(activeTouchesRef.current.values())[0];
        lastTouchRef.current = { x: remaining.x, y: remaining.y };
        pinchRef.current = null;
        movedRef.current = false;
        return;
      }

      // 3+ → 2+ finger transitions are handled implicitly: the
      // next pointermove with count >= 2 re-runs the pinch
      // branch using the live touch positions.
    },
    // handleWindowPointerMove is stable; resetTouchGesture is
    // memoized above. Empty deps intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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
            // Cursor reflects the active gesture, not the legacy
            // dragRef (which is now always null). 'grabbing' on
            // either rotate or pinch lets the user know the
            // wrapper has captured their input.
            cursor:
              gestureRef.current === 'rotate' ||
              gestureRef.current === 'pinch'
                ? 'grabbing'
                : 'grab',
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
export const Globe = GlobeImpl;