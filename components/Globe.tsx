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

// Click within this angular distance of a marker's lat/lng fires the callback.
const MARKER_HIT_THRESHOLD_DEG = 6;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.15;

export function Globe({ markers = [], onMarkerSelect }: Props = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Live camera state, updated each onRender frame so click hit-tests match what's on screen.
  const phiRef = useRef(0);
  const thetaRef = useRef(0.25);
  // CSS-transform zoom — kept on a ref so wheel events don't re-render the globe.
  const scaleRef = useRef(1);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  // Keep latest callback without re-binding the click handler each render.
  const onSelectRef = useRef(onMarkerSelect);
  onSelectRef.current = onMarkerSelect;

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
        phiRef.current += 0.005;
        state.width = width * 2;
        thetaRef.current = state.theta;
      },
    });

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
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const dist2 = nx * nx + ny * ny;
      if (dist2 > 1) return; // click outside the disc

      const phi = phiRef.current;
      const theta = thetaRef.current;

      // Camera-space surface point (orthographic, +Z toward viewer).
      const cz = Math.sqrt(1 - dist2);
      let x = nx, y = -ny, z = cz;

      // World = R_y(-phi) ∘ R_x(-theta) applied to the camera-space point.
      // R_x(-theta): x' = x, y' = y cosθ + z sinθ, z' = -y sinθ + z cosθ
      const tc = Math.cos(-theta);
      const ts = Math.sin(-theta);
      const x1 = x;
      const y1 = tc * y - ts * z;
      const z1 = ts * y + tc * z;

      // R_y(-phi): x' = x cosφ - z sinφ, y' = y, z' = x sinφ + z cosφ
      // (cobe's phi rotates the globe the other way, so the inverse uses +phi.)
      const pc = Math.cos(phi);
      const ps = Math.sin(phi);
      const x2 = pc * x1 - ps * z1;
      const z2 = ps * x1 + pc * z1;
      const y2 = y1;

      const latRad = Math.asin(Math.max(-1, Math.min(1, y2)));
      const lngRad = Math.atan2(z2, x2);

      // Great-circle distance to each marker; pick nearest if within threshold.
      let bestIdx = -1;
      let bestDist = Infinity;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      for (let i = 0; i < markers.length; i++) {
        const [mlat, mlng] = markers[i].location;
        const a =
          Math.sin((toRad(mlat) - latRad) / 2) ** 2 +
          Math.cos(latRad) *
            Math.cos(toRad(mlat)) *
            Math.sin((toRad(mlng) - lngRad) / 2) ** 2;
        const d = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      const threshold = (MARKER_HIT_THRESHOLD_DEG * Math.PI) / 180;
      if (bestIdx >= 0 && bestDist < threshold) {
        cb(bestIdx);
      }
    };
    canvas.addEventListener('click', handleClick);

    return () => {
      globe.destroy();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('click', handleClick);
      canvas.style.transform = '';
    };
  }, [markers]);

  const resetZoom = () => {
    scaleRef.current = 1;
    if (canvasRef.current) canvasRef.current.style.transform = 'scale(1)';
    setZoomDisplay(1);
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
      {zoomDisplay !== 1 && (
        <button
          type="button"
          onClick={resetZoom}
          className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/70 px-4 py-1.5 text-xs text-white/80 backdrop-blur-sm transition hover:bg-black/90"
          aria-label="重置缩放"
        >
          {zoomDisplay.toFixed(1)}× · 重置
        </button>
      )}
    </div>
  );
}
