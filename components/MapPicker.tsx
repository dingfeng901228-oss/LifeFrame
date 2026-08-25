'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, MapMouseEvent, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export type PickedLocation = {
  lat: number;
  lng: number;
  name: string;
};

type Props = {
  initial?: PickedLocation | null;
  onSelect: (loc: PickedLocation) => void;
  onClose: () => void;
};

// OpenStreetMap raster tiles — no token, no signup. Rate-limit friendly
// because we only fire reverse-geocode on click and search on user action.
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster' as const,
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

const NOMINATIM_UA = 'LifeFrame/0.1 (https://lifeframe.frank2025.com)';

function shortName(display: string | undefined, fallback: string): string {
  if (!display) return fallback;
  return display.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
}

export function MapPicker({ initial, onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [picked, setPicked] = useState<PickedLocation | null>(initial ?? null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<
    Array<{ lat: number; lng: number; name: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] = initial
      ? [initial.lng, initial.lat]
      : [139.7, 35.7]; // Tokyo default — Frank's home region
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE as any,
      center,
      zoom: initial ? 12 : 4,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl(), 'top-right');

    m.on('click', async (e: MapMouseEvent) => {
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;
      const coordLabel = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      setPicked({ lat, lng, name: '查询中…' });
      setError(null);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh`,
          { headers: { 'User-Agent': NOMINATIM_UA } },
        );
        if (!res.ok) throw new Error(`reverse ${res.status}`);
        const data = (await res.json()) as { display_name?: string };
        setPicked({
          lat,
          lng,
          name: shortName(data.display_name, coordLabel),
        });
      } catch (err) {
        setPicked({ lat, lng, name: coordLabel });
        setError(
          err instanceof Error
            ? `反查地名失败：${err.message}`
            : '反查地名失败',
        );
      }
    });

    mapRef.current = m;

    return () => {
      m.remove();
      mapRef.current = null;
    };
    // initial is referenced only for the initial center; subsequent
    // changes flow through the marker effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move / create marker when picked changes
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (picked) {
      markerRef.current = new maplibregl.Marker({ color: '#67e8f9' })
        .setLngLat([picked.lng, picked.lat])
        .addTo(m);
    }
  }, [picked]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          search,
        )}&limit=5&accept-language=zh`,
        { headers: { 'User-Agent': NOMINATIM_UA } },
      );
      if (!res.ok) throw new Error(`search ${res.status}`);
      const data = (await res.json()) as Array<{
        lat: string;
        lon: string;
        display_name: string;
      }>;
      setSearchResults(
        data.map((r) => ({
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          name: r.display_name,
        })),
      );
    } catch (err) {
      setError(
        err instanceof Error ? `搜索失败：${err.message}` : '搜索失败',
      );
    } finally {
      setSearching(false);
    }
  }

  function pickResult(r: { lat: number; lng: number; name: string }) {
    const m = mapRef.current;
    const label = shortName(r.name, `${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}`);
    setPicked({ lat: r.lat, lng: r.lng, name: label });
    setSearchResults([]);
    setSearch('');
    m?.flyTo({ center: [r.lng, r.lat], zoom: 12 });
  }

  function confirm() {
    if (picked) onSelect(picked);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-white/15 bg-black"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-lg font-light">🗺️ 选择拍摄地点</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-white/60 hover:text-white"
          >
            ✕ 关闭 (ESC)
          </button>
        </div>

        {/* Search */}
        <form
          onSubmit={doSearch}
          className="flex gap-2 border-b border-white/10 px-5 py-3"
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索地点（如 富士山 / Tokyo Tower / Beijing）"
            className="flex-1 rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {searching ? '搜索中…' : '搜索'}
          </button>
        </form>

        {searchResults.length > 0 && (
          <div className="max-h-32 overflow-y-auto border-b border-white/10">
            {searchResults.map((r, i) => (
              <button
                key={`${r.lat}-${r.lng}-${i}`}
                type="button"
                onClick={() => pickResult(r)}
                className="block w-full truncate border-b border-white/5 px-5 py-2 text-left text-xs text-white/70 hover:bg-white/10"
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="border-b border-white/10 bg-rose-900/20 px-5 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Map */}
        <div ref={containerRef} className="flex-1 cursor-crosshair" />

        {/* Footer */}
        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {picked ? (
              <span className="text-white/80">
                📍{' '}
                <span className="font-medium text-white">
                  {picked.name}
                </span>
                <span className="ml-2 text-white/40">
                  ({picked.lat.toFixed(4)}, {picked.lng.toFixed(4)})
                </span>
              </span>
            ) : (
              <span className="text-white/40">
                点击地图选择地点，或上方搜索
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={!picked}
            className="rounded bg-cyan-400 px-5 py-2 text-sm font-medium text-black transition hover:bg-cyan-300 disabled:opacity-30"
          >
            确认选择
          </button>
        </div>
      </div>
    </div>
  );
}
