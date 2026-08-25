'use client';

import createGlobe from 'cobe';
import { useEffect, useRef } from 'react';

type Marker = { location: [number, number]; size?: number };

export function Globe({ markers = [] }: { markers?: Marker[] } = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let phi = 0;
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
        state.phi = phi;
        phi += 0.005;
        state.width = width * 2;
      },
    });

    return () => {
      globe.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, [markers]);

  return (
    <div className="flex h-full w-full items-center justify-center">
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
        }}
      />
    </div>
  );
}
