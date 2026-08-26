'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
};

const MIN_SCALE = 220;
const MAX_SCALE = 1400;
const INITIAL_ROTATION: [number, number] = [0, -22]; // lambda, phi in degrees
const ROTATE_DEG_PER_SEC = 3.6;
const DRAG_SENSITIVITY = 0.32;

/**
 * Orthographic globe renderer.
 *
 * Why we moved off cobe: cobe's texture is baked into its WebGL shader
 * and the d.ts surface has no `mapUrl` option. After two failed passes
 * trying to layer DOM/SVG country outlines on top of cobe, we replace
 * it entirely with d3-geo + SVG. Country outlines are real geometry
 * (rendered as SVG <path> from a TopoJSON FeatureCollection), photo
 * markers are SVG <circle> with native onClick handlers — so the click
 * pipeline no longer depends on forward-projection math lining up with
 * cobe's internal rotation matrix.
 *
 * Rotation state is a `[lambda, phi]` pair in degrees (lambda is
 * longitude, phi is latitude). d3-geo's `geoOrthographic().rotate([λ, φ])`
 * does the heavy lifting; we mutate λ/φ on drag and tick.
 */
export function Globe({ markers = [], onMarkerSelect }: Props = {}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(700);
  const [rotation, setRotation] =
    useState<[number, number]>(INITIAL_ROTATION);
  const [scale, setScale] = useState(360);
  const [autoRotate, setAutoRotate] = useState(true);

  const dragRef = useRef<{
    x: number;
    y: number;
    rot: [number, number];
  } | null>(null);

  // ── Resize observer → keep SVG dimensions in sync with wrapper ──
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const measure = () => {
      const s = Math.min(el.clientWidth, el.clientHeight);
      if (s > 0) setSize(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Scale to fit initial wrapper size ───────────────────────────
  useEffect(() => {
    if (size <= 0) return;
    const initialScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, size * 0.62));
    setScale(initialScale);
  }, [size]);

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
  // individual dots; multi-marker clusters render as a circle with
  // a count. Threshold is in screen px, not degrees — it works
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

  // Cluster click → zoom in by 1.8×. The next render re-clusters at
  // the new scale; tight clusters naturally split. Capped by MAX_SCALE
  // so we don't run off the rails on repeated clicks.
  const zoomIntoCluster = useCallback(() => {
    setScale((s) => Math.min(s * 1.8, MAX_SCALE));
  }, []);

  // ── Drag handling (pointer events for unified mouse/touch) ─────
  // Window-level pointermove/pointerup listeners are attached on
  // pointerdown so drag keeps working even when the pointer leaves
  // the wrapper (e.g. touch dragged off-screen). This replaces the
  // previous setPointerCapture approach — setPointerCapture redirects
  // click events to the capture target (per Pointer Events spec), which
  // silently broke marker onClick. Without it, clicks fire on the
  // original target (the marker <g>) and the photo detail modal opens.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      rot: [...rotation],
    };
    setAutoRotate(false);
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp, { once: true });
    window.addEventListener('pointercancel', handleWindowPointerUp, { once: true });
  };

  const handleWindowPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    let lambda = (d.rot[0] + dx * DRAG_SENSITIVITY) % 360;
    if (lambda > 180) lambda -= 360;
    if (lambda < -180) lambda += 360;
    const phi = Math.max(-90, Math.min(90, d.rot[1] - dy * DRAG_SENSITIVITY));
    setRotation([lambda, phi]);
  };

  const handleWindowPointerUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerUp);
  };

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, []);

  // ── Wheel zoom ──────────────────────────────────────────────────
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setScale((s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * factor)));
  };

  // ── Click delegation ────────────────────────────────────────────
  // setPointerCapture() above redirects the click event to the wrapper
  // div (per the Pointer Events spec — once a pointer is captured, all
  // subsequent events including click are dispatched to the capture
  // target). The marker <g>'s own onClick therefore never fires. To
  // still open the photo modal, listen for click on the wrapper and
  // walk up from event.target to find the nearest marker (identified
  // by data-marker-index).
  // NOTE: this delegation handler is now removed — we no longer call
  // setPointerCapture (see handlePointerDown), so the marker <g> click
  // handlers below fire directly. The wrapper's no longer needs the
  // delegation path.

  return (
    <div className="relative flex h-full w-full items-center justify-center select-none">
      <div
        ref={wrapperRef}
        className="relative overflow-hidden rounded-full"
        style={{
          // Sized down from 85vh to 70vh so the Timeline below has room
          // to render without overlapping the globe on desktop. The
          // draggable Timeline needs more vertical real estate than the
          // old click-only one (drag handle + bigger hit area), so we
          // give the globe the top ~70% of the viewport.
          width: 'min(70vh, 70vw, 760px)',
          height: 'min(70vh, 70vw, 760px)',
          aspectRatio: '1',
          touchAction: 'none',
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
      >
        <svg
          width={size}
          height={size}
          viewBox={`-${size / 2} -${size / 2} ${size} ${size}`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <defs>
            <radialGradient id="oceanGrad" cx="38%" cy="35%" r="75%">
              <stop offset="0%" stopColor="#152037" />
              <stop offset="65%" stopColor="#0a0e1a" />
              <stop offset="100%" stopColor="#04060d" />
            </radialGradient>
          </defs>

          {/* Ocean / sphere background */}
          <circle
            r={size / 2 - 2}
            fill="url(#oceanGrad)"
            stroke="rgba(255, 255, 255, 0.18)"
            strokeWidth={1}
          />

          {/* Country borders & land */}
          <g>
            {countryPaths.map((c) => (
              <path
                key={c.id}
                d={c.d}
                fill="rgba(35, 48, 80, 0.85)"
                stroke="rgba(103, 232, 249, 0.55)"
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
                      fill="rgba(103, 232, 249, 0.22)"
                      stroke="rgba(103, 232, 249, 0.5)"
                      strokeWidth={1}
                      pointerEvents="none"
                    />
                    <circle
                      r={3.5}
                      fill="rgb(103, 232, 249)"
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
                  onClick={zoomIntoCluster}
                >
                  {/* Outer halo for affordance */}
                  <circle
                    r={r + 6}
                    fill="rgba(103, 232, 249, 0.12)"
                    pointerEvents="all"
                  />
                  {/* Cluster body */}
                  <circle
                    r={r}
                    fill="rgba(103, 232, 249, 0.45)"
                    stroke="rgba(103, 232, 249, 0.9)"
                    strokeWidth={1.5}
                    pointerEvents="none"
                  />
                  {/* Count label */}
                  <text
                    textAnchor="middle"
                    dy="0.35em"
                    fontSize={Math.min(11 + Math.log10(c.count) * 6, 18)}
                    fontWeight="bold"
                    fill="rgb(255, 255, 255)"
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
    </div>
  );
}
