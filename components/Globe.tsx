'use client';

import createGlobe from 'cobe';
import { useEffect, useRef, useState } from 'react';

export type GlobeMarker = {
  location: [number, number];
  size?: number;
};

type Props = {
  markers?: GlobeMarker[];
  onMarkerSelect?: (index: number) => void;
};

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.15;
// Canvas-space hit radius (in canvas-normalized [-1, 1] coords).
// 0.12 ≈ 12% of half-width — generous enough to grab moving markers.
const HIT_THRESHOLD = 0.12;
const HIT_THRESHOLD_SQ = HIT_THRESHOLD * HIT_THRESHOLD;

/**
 * Forward-project a marker (lat, lng) to canvas-space (sx, sy ∈ [-1, 1]).
 * Uses the same R_x(theta) ∘ R_y(phi) chain cobe applies when rendering the
 * globe. Returns null when the marker is on the back hemisphere (z2 ≤ 0)
 * and therefore not visible.
 */
function projectMarker(
  latDeg: number,
  lngDeg: number,
  phi: number,
  theta: number,
): { sx: number; sy: number } | null {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const latR = toRad(latDeg);
  const lngR = toRad(lngDeg);
  // Unit-sphere world point (cobe's equirectangular convention)
  const wx = Math.cos(latR) * Math.cos(lngR);
  const wy = Math.sin(latR);
  const wz = Math.cos(latR) * Math.sin(lngR);
  // R_x(theta)
  const tc = Math.cos(theta);
  const ts = Math.sin(theta);
  const x1 = wx;
  const y1 = tc * wy - ts * wz;
  const z1 = ts * wy + tc * wz;
  // R_y(phi)
  const pc = Math.cos(phi);
  const ps = Math.sin(phi);
  const x2 = pc * x1 + ps * z1;
  const y2 = y1;
  const z2 = -ps * x1 + pc * z1;
  if (z2 <= 0) return null;
  // Orthographic projection. Canvas +Y is screen-down, world +Y is up.
  return { sx: x2, sy: -y2 };
}

export function Globe({ markers = [], onMarkerSelect }: Props = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Live camera state, updated each onRender frame so click hit-tests
  // match what cobe is rendering right now.
  const phiRef = useRef(0);
  const thetaRef = useRef(0.25);
  // CSS-transform zoom — kept on a ref so wheel events don't re-render.
  const scaleRef = useRef(1);
  const autoRotateRef = useRef(true);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  // Keep latest callback without re-binding the click handler each render.
  const onSelectRef = useRef(onMarkerSelect);
  onSelectRef.current = onMarkerSelect;
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let width = 0;
    const onResize = () => {
      if (canvas) width = canvas.offsetWidth;
    };
    window.addEventListener('resize', onResize);
    onResize();

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: 1200,
      height: 1200,
      phi: 0,
      theta: 0.25,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      baseColor: [0.2, 0.2, 0.25],
      markerColor: [0.4, 0.9, 1],
      glowColor: [1, 1, 1],
      markers: markers.map((m) => ({
        location: m.location,
        size: m.size ?? 0.05,
      })),
      onRender: (state) => {
        state.phi = phiRef.current;
        if (autoRotateRef.current) {
          // Wrap to [0, 2π) so phiRef doesn't grow without bound over hours
          // (sin/cos tolerate huge values but it cleans up the math).
          phiRef.current = (phiRef.current + 0.005) % (Math.PI * 2);
        }
        state.width = width * 2;
        thetaRef.current = state.theta;
      },
    });

    /** Forward-project every marker; drops ones on the back of the globe. */
    const projectAll = () => {
      const phi = phiRef.current;
      const theta = thetaRef.current;
      const out: { sx: number; sy: number; i: number }[] = [];
      for (let i = 0; i < markers.length; i++) {
        const [latD, lngD] = markers[i].location;
        const p = projectMarker(latD, lngD, phi, theta);
        if (p) out.push({ sx: p.sx, sy: p.sy, i });
      }
      return out;
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = Math.max(
        MIN_ZOOM,
        Math.min(MAX_ZOOM, scaleRef.current * factor),
      );
      if (next !== scaleRef.current) {
        scaleRef.current = next;
        canvas.style.transform = `scale(${next})`;
        setZoomDisplay(next);
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    const handleClick = (e: MouseEvent) => {
      const cb = onSelectRef.current;
      if (!cb || markers.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const cnx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const cny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const visible = projectAll();
      let bestIdx = -1;
      let bestDist2 = Infinity;
      for (const m of visible) {
        const dx = m.sx - cnx;
        const dy = m.sy - cny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestIdx = m.i;
        }
      }
      if (bestIdx >= 0 && bestDist2 < HIT_THRESHOLD_SQ) {
        cb(bestIdx);
      }
    };
    canvas.addEventListener('click', handleClick);

    // Hover hint: cursor switches to pointer when over a marker region.
    const handleMouseMove = (e: MouseEvent) => {
      if (markers.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const cnx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const cny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const visible = projectAll();
      let nearest2 = Infinity;
      for (const m of visible) {
        const dx = m.sx - cnx;
        const dy = m.sy - cny;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearest2) nearest2 = d2;
      }
      canvas.style.cursor =
        nearest2 < HIT_THRESHOLD_SQ ? 'pointer' : 'grab';
    };
    canvas.addEventListener('mousemove', handleMouseMove);

    return () => {
      globe.destroy();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.style.transform = '';
    };
  }, [markers]);

  const resetZoom = () => {
    scaleRef.current = 1;
    if (canvasRef.current) canvasRef.current.style.transform = 'scale(1)';
    setZoomDisplay(1);
  };

  const toggleAutoRotate = () => {
    setAutoRotate((prev) => !prev);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        style={{
          width: 'min(85vh, 85vw, 900px)',
          height: 'min(85vh, 85vw, 900px)',
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: '1',
          cursor: 'grab',
          contain: 'layout paint size',
          transformOrigin: 'center center',
          transition: 'transform 80ms ease-out',
        }}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
        <button
          type="button"
          onClick={toggleAutoRotate}
          className="pointer-events-auto rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-xs text-white/80 backdrop-blur-sm transition hover:bg-black/90"
          aria-label={autoRotate ? '暂停旋转' : '继续旋转'}
        >
          {autoRotate ? '❚❚ 暂停' : '▶ 继续'}
        </button>
        {zoomDisplay !== 1 && (
          <button
            type="button"
            onClick={resetZoom}
            className="pointer-events-auto rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-xs text-white/80 backdrop-blur-sm transition hover:bg-black/90"
            aria-label="重置缩放"
          >
            {zoomDisplay.toFixed(1)}× · 重置
          </button>
        )}
      </div>
    </div>
  );
}
