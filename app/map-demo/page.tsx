'use client';

import { useState } from 'react';
import { PhotoMap, type PhotoMapMarker } from '@/components/PhotoMap';

// Hardcoded sample markers for Phase 2 validation. Real photo data
// arrives in Phase 3+ when SpatialExplorer wires this into the
// homepage. Includes a deliberate Tokyo cluster (3 close points) to
// exercise MapLibre's cluster expansion on click.
const SAMPLE_MARKERS: PhotoMapMarker[] = [
  // Tokyo cluster — exercises cluster expansion
  { id: 't1', lat: 35.6762, lng: 139.6503, filename: 'Tokyo Tower' },
  { id: 't2', lat: 35.6895, lng: 139.6917, filename: 'Shinjuku' },
  { id: 't3', lat: 35.6586, lng: 139.7454, filename: 'Skytree' },
  // Other major cities — single points
  { id: 'p1', lat: 48.8566, lng: 2.3522, filename: 'Paris' },
  { id: 'n1', lat: 40.7128, lng: -74.006, filename: 'NYC' },
  { id: 'h1', lat: 22.3193, lng: 114.1694, filename: 'Hong Kong' },
  { id: 's1', lat: -33.8688, lng: 151.2093, filename: 'Sydney' },
  { id: 'l1', lat: 51.5074, lng: -0.1278, filename: 'London' },
  { id: 'b1', lat: -22.9068, lng: -43.1729, filename: 'Rio' },
  { id: 'c1', lat: 30.5728, lng: 104.0668, filename: 'Chengdu' },
];

export default function MapDemoPage() {
  const [clicks, setClicks] = useState<string[]>([]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <header className="absolute top-3 left-3 z-10 rounded-md bg-black/70 px-3 py-2 text-xs text-white shadow-lg backdrop-blur">
        <div className="font-medium">PhotoMap dev demo</div>
        <div className="mt-0.5 opacity-70">
          markers: {SAMPLE_MARKERS.length} · clicks: {clicks.length}
          {clicks.length > 0 && ` · last: ${clicks[clicks.length - 1]}`}
        </div>
      </header>
      <PhotoMap
        markers={SAMPLE_MARKERS}
        initialCenter={[0, 20]}
        initialZoom={1.8}
        onMarkerClick={(id) => setClicks((c) => [...c, id])}
      />
    </main>
  );
}
