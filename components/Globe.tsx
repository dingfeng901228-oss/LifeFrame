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
// Fallback canvas-click hit radius (canvas-normalized, [-1, 1]).
const HIT_THRESHOLD = 0.12;
const HIT_THRESHOLD_SQ = HIT_THRESHOLD * HIT_THRESHOLD;

/**
 * Forward-project marker (lat, lng) to canvas-space (sx, sy ∈ [-1, 1]).
 * Mirrors cobe's render math: R_x(theta) ∘ R_y(phi). Returns null when
 * the marker is on the back of the globe (z2 ≤ 0).
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
  // Cobe's equirectangular convention: x = cos·cos, y = sin, z = cos·sin
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
  // Canvas y is screen-down while world y is up.
  return { sx: x2, sy: -y2 };
}

export function Globe({ markers = [], onMarkerSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const zoomWrapperRef = useRef<HTMLDivElement | null>(null);
  // Live camera state, updated each onRender frame.
  const phiRef = useRef(0);
  const thetaRef = useRef(0.25);
  // CSS-transform zoom on a ref so wheel events don't trigger re-render.
  const scaleRef = useRef(1);
  const autoRotateRef = useRef(true);
  const [zoomDisplay, setZoomDisplay] = useState(1);
  const [autoRotate, setAutoRotate] = useState(true);
  // Keep latest callback without re-binding listeners on every render.
  const onSelectRef = useRef(onMarkerSelect);
  onSelectRef.current = onMarkerSelect;
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const zoomWrapper = zoomWrapperRef.current;
    if (!canvas || !overlay || !zoomWrapper) return;

    let width = 0;
    const onResize = () => {
      if (canvas) width = canvas.offsetWidth;
    };
    window.addEventListener('resize', onResize);
    onResize();

    // ── DOM overlay dots ──────────────────────────────────────────────
    // One real <button> per marker, positioned every frame so it tracks
    // cobe's marker. Clicking the button opens detail modal. This is the
    // primary interaction path; the canvas-click handler below is just a
    // fallback in case a DOM dot fails to render for some reason.
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    const dots: HTMLButtonElement[] = [];
    for (let i = 0; i < markers.length; i++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.style.position = 'absolute';
      dot.style.left = '50%';
      dot.style.top = '50%';
      dot.style.transform = 'translate(-50%, -50%)';
      dot.style.width = '26px';
      dot.style.height = '26px';
      dot.style.borderRadius = '9999px';
      dot.style.border = '2px solid rgba(103, 232, 249, 0.8)';
      dot.style.background = 'rgba(103, 232, 249, 0.25)';
      dot.style.cursor = 'pointer';
      dot.style.pointerEvents = 'auto';
      dot.style.display = 'none';
      dot.style.transition = 'transform 120ms ease-out, background 120ms';
      dot.style.boxShadow = '0 0 14px rgba(103, 232, 249, 0.35)';
      dot.setAttribute(
        'aria-label',
        `打开照片 ${markers[i].location[0].toFixed(2)},${markers[i].location[1].toFixed(2)}`,
      );
      dot.onmouseenter = () => {
        dot.style.transform = 'translate(-50%, -50%) scale(1.35)';
        dot.style.background = 'rgba(103, 232, 249, 0.6)';
      };
      dot.onmouseleave = () => {
        dot.style.transform = 'translate(-50%, -50%) scale(1)';
        dot.style.background = 'rgba(103, 232, 249, 0.25)';
      };
      dot.onclick = () => onSelectRef.current?.(i);
      overlay.appendChild(dot);
      dots.push(dot);
    }

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
          // Wrap to [0, 2π) so phiRef doesn't grow without bound.
          phiRef.current = (phiRef.current + 0.005) % (Math.PI * 2);
        }
        state.width = width * 2;
        thetaRef.current = state.theta;

        // Position DOM overlay dots using the same camera state cobe is
        // rendering with (state.phi was just set above to phiRef.current,
        // which equals phiRef.current minus the post-increment value used
        // for next frame). Using the post-increment value introduces a
        // 0.005 rad (~0.29°) offset which is well within a 26px click
        // target, so use the fresh value for positioning here.
        const phiNow = state.phi;
        const thetaNow = thetaRef.current;
        for (let i = 0; i < markers.length && i < dots.length; i++) {
          const dot = dots[i];
          const p = projectMarker(
            markers[i].location[0],
            markers[i].location[1],
            phiNow,
            thetaNow,
          );
          if (p) {
            dot.style.left = `${(p.sx + 1) * 50}%`;
            dot.style.top = `${(1 - p.sy) * 50}%`;
            dot.style.display = '';
          } else {
            dot.style.display = 'none';
          }
        }
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
        zoomWrapper.style.transform = `scale(${next})`;
        setZoomDisplay(next);
      }
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Canvas-click fallback (in case DOM dots somehow don't render).
    const handleClick = (e: MouseEvent) => {
      const cb = onSelectRef.current;
      if (!cb || markers.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const cnx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const cny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const phi = phiRef.current;
      const theta = thetaRef.current;
      let bestIdx = -1;
      let bestDist2 = Infinity;
      for (let i = 0; i < markers.length; i++) {
        const p = projectMarker(
          markers[i].location[0],
          markers[i].location[1],
          phi,
          theta,
        );
        if (!p) continue;
        const dx = p.sx - cnx;
        const dy = p.sy - cny;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestDist2 < HIT_THRESHOLD_SQ) {
        cb(bestIdx);
      }
    };
    canvas.addEventListener('click', handleClick);

    return () => {
      globe.destroy();
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('click', handleClick);
      zoomWrapper.style.transform = '';
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    };
  }, [markers]);

  const resetZoom = () => {
    scaleRef.current = 1;
    if (zoomWrapperRef.current) zoomWrapperRef.current.style.transform = 'scale(1)';
    setZoomDisplay(1);
  };

  const toggleAutoRotate = () => {
    setAutoRotate((prev) => !prev);
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div
        ref={zoomWrapperRef}
        className="relative"
        style={{
          width: 'min(85vh, 85vw, 900px)',
          height: 'min(85vh, 85vw, 900px)',
          aspectRatio: '1',
          transformOrigin: 'center center',
          transition: 'transform 80ms ease-out',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            cursor: 'grab',
            contain: 'layout paint size',
            display: 'block',
          }}
        />
        <div
          ref={overlayRef}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        />
      </div>
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
