'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

  // ── Drag handling (pointer events for unified mouse/touch) ─────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      rot: [...rotation],
    };
    setAutoRotate(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* noop — pointer might already be released */
      }
      dragRef.current = null;
    }
  };

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
  const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    const markerEl = target?.closest('[data-marker-index]');
    if (!markerEl) return;
    const idx = Number(markerEl.getAttribute('data-marker-index'));
    if (Number.isFinite(idx) && idx >= 0) {
      onMarkerSelect?.(idx);
    }
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center select-none">
      <div
        ref={wrapperRef}
        className="relative overflow-hidden rounded-full"
        style={{
          width: 'min(85vh, 85vw, 900px)',
          height: 'min(85vh, 85vw, 900px)',
          aspectRatio: '1',
          touchAction: 'none',
          cursor: dragRef.current ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onClick={handleWrapperClick}
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

          {/* Photo markers — SVG circle. onClick lives on the wrapper
              (handleWrapperClick) because setPointerCapture redirects
              click to the capture target. data-marker-index lets the
              wrapper's click handler find which marker was clicked. */}
          <g>
            {projectedMarkers.map((m) => (
              <g
                key={m.i}
                data-marker-index={m.i}
                transform={`translate(${m.x}, ${m.y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => {
                  const target = e.currentTarget;
                  target.querySelectorAll('circle').forEach((c) => {
                    c.setAttribute('r', c.getAttribute('data-base-r') || c.getAttribute('r') || '');
                  });
                  target.setAttribute('data-hover', '1');
                }}
              >
                <circle
                  r={9}
                  fill="rgba(103, 232, 249, 0.22)"
                  stroke="rgba(103, 232, 249, 0.5)"
                  strokeWidth={1}
                />
                <circle r={3.5} fill="rgb(103, 232, 249)" />
              </g>
            ))}
          </g>
        </svg>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        <button
          type="button"
          onClick={() => setAutoRotate((v) => !v)}
          className="pointer-events-auto rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-xs text-white/80 backdrop-blur-sm transition hover:bg-black/90"
          aria-label={autoRotate ? '暂停旋转' : '继续旋转'}
        >
          {autoRotate ? '❚❚ 暂停' : '▶ 继续'}
        </button>
      </div>
    </div>
  );
}
