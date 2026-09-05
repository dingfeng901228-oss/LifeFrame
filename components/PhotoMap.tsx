'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  Map as MlMap,
  GeoJSONSource,
  LngLatLike,
  MapLayerMouseEvent,
  ErrorEvent as MlErrorEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_STYLE_URL,
  DEFAULT_MAP_ZOOM,
} from './mapConfig';

/**
 * Photo marker for PhotoMap's GeoJSON source.
 * Filename + taken_at are carried through for the future popup
 * layer (spec §15 "current area / photo marker / photo count /
 * time-filtered results"). Phase 2 only renders circles.
 */
export type PhotoMapMarker = {
  id: string;
  lat: number;
  lng: number;
  filename?: string;
  taken_at?: string | null;
};

type Props = {
  markers: PhotoMapMarker[];
  initialCenter?: [number, number];
  initialZoom?: number;
  onMarkerClick?: (id: string) => void;
  /** Fired once when the basemap + photo source are loaded. Phase 3
   *  SpatialExplorer uses this to gate the crossfade (spec §12, §41:
   *  "don't let Globe disappear before the map is ready"). */
  onMapReady?: () => void;
  /** MapLibre second-round fix (Frank #7914): PhotoMap reports
   *  errors up so SpatialExplorer can cancel an in-flight
   *  transition back to 'globe' (preventing the "黑屏 + 无法返回"
   *  failure mode). The argument is a short human-readable
   *  message — SpatialExplorer doesn't branch on the message,
   *  only on the fact that an error was reported. */
  onMapError?: (message: string) => void;
  /** Fired on every move-end. Phase 5 Map → Globe reverse needs
   *  this to save the user's last map state. */
  onMoveEnd?: (center: [number, number], zoom: number) => void;
  className?: string;
};

/**
 * Standalone MapLibre photo map.
 *
 * Phase 2 scope: independent component to validate MapLibre setup
 * + GeoJSON clustering before SpatialExplorer wraps it (Phase 3+).
 *
 * Markers render as a single GeoJSON source with built-in MapLibre
 * clustering. Clusters (point_count > 1) are cyan circles whose
 * radius scales with point_count; clicking zooms in to the
 * expansion zoom. Single markers are smaller circles; clicking
 * fires onMarkerClick with the marker's id.
 *
 * No text labels in Phase 2 — cluster size encodes count visually.
 * Text labels (with proper glyph endpoint) will be added in Phase 9.
 */
export function PhotoMap({
  markers,
  initialCenter = DEFAULT_MAP_CENTER,
  initialZoom = DEFAULT_MAP_ZOOM,
  onMarkerClick,
  onMapReady,
  onMapError,
  onMoveEnd,
  className = 'h-full w-full',
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  // mapLoaded gates the markers-update effect so we never call
  // setData on a source that hasn't been added yet.
  const [mapLoaded, setMapLoaded] = useState(false);

  // Stable refs for callbacks so the init effect can stay empty-deps
  // (init effect running twice would remount the map).
  const onMarkerClickRef = useRef(onMarkerClick);
  const onMapReadyRef = useRef(onMapReady);
  const onMapErrorRef = useRef(onMapError);
  const onMoveEndRef = useRef(onMoveEnd);
  onMarkerClickRef.current = onMarkerClick;
  onMapReadyRef.current = onMapReady;
  onMapErrorRef.current = onMapError;
  onMoveEndRef.current = onMoveEnd;

  // ── Init map (run once on mount) ──────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;

    // MapLibre second-round fix (Frank #7914 spec §50): verify
    // the container has real dimensions before initializing
    // MapLibre. Initializing inside a zero-sized or display:none
    // element yields a canvas with width/height = 0, which
    // silently fails WebGL rendering and leaves the user on a
    // black Map screen after the crossfade. SpatialTransition
    // already gates visibility, but the wrapper can still mount
    // at 0×0 before ResizeObserver fires, so we double-check.
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) {
      const msg = `PhotoMap container has no size (${cw}×${ch}); deferring init`;
      console.warn(`[PhotoMap] ${msg}`);
      onMapErrorRef.current?.(msg);
      return;
    }

    const map = new maplibregl.Map({
      container,
      style: DEFAULT_MAP_STYLE_URL,
      center: initialCenter as LngLatLike,
      zoom: initialZoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );

    // Spec §40: don't crash the page on MapLibre error. Phase 3
    // SpatialExplorer will hide this map and keep the globe on
    // screen; for Phase 2 we just log.
    //
    // MapLibre second-round fix (Frank #7914 spec §47-52): now
    // ALSO report errors up to SpatialExplorer via onMapError so
    // it can force-complete any in-flight transition back to
    // 'globe'. Without this, a tile/style load failure during the
    // forward crossfade leaves the user stranded on the broken
    // Map screen — exactly the "黑屏 + attribution + 无法返回"
    // symptom Frank reported.
    map.on('error', (e: MlErrorEvent) => {
      const message = e?.error?.message ?? String(e);
      // eslint-disable-next-line no-console
      console.error('[PhotoMap] MapLibre error:', message);
      onMapErrorRef.current?.(message);
    });

    map.on('load', () => {
      // MapLibre second-round fix (Frank #7914 spec §49): verify
      // style is actually loaded before declaring the map ready
      // and kicking the crossfade. map.on('load') fires once per
      // map instance but doesn't guarantee that every style layer
      // resolved cleanly — especially with the OpenFreeMap
      // basemap, which depends on remote tile servers.
      if (!map.isStyleLoaded()) {
        const msg = 'MapLibre style not loaded after "load" event';
        console.warn(`[PhotoMap] ${msg}`);
        onMapErrorRef.current?.(msg);
        return;
      }

      // Empty source — populated by the markers-update effect.
      map.addSource('photos', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: CLUSTER_RADIUS,
      });

      // Cluster circles — sized by point_count.
      map.addLayer({
        id: 'photo-clusters',
        type: 'circle',
        source: 'photos',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#22d3ee',
          'circle-opacity': 0.5,
          'circle-stroke-color': '#0ea5e9',
          'circle-stroke-width': 1.5,
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            16, // 1–9 photos
            22, // 10–49
            28, // 50–199
            34, // 200+
          ],
        },
      });

      // Single-marker circles.
      map.addLayer({
        id: 'photo-points',
        type: 'circle',
        source: 'photos',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#22d3ee',
          'circle-opacity': 0.85,
          'circle-radius': 7,
          'circle-stroke-color': '#0ea5e9',
          'circle-stroke-width': 1,
        },
      });

      // Cluster click → easeTo expansion zoom.
      map.on('click', 'photo-clusters', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.properties?.cluster_id == null) return;
        const source = map.getSource('photos') as
          | GeoJSONSource
          | undefined;
        if (!source) return;
        const id = f.properties.cluster_id as number;
        const geom = f.geometry as {
          type: 'Point';
          coordinates: [number, number];
        };
        source
          .getClusterExpansionZoom(id)
          .then((zoom) => {
            map.easeTo({
              center: geom.coordinates,
              zoom: Math.min(zoom, 16),
            });
          })
          .catch(() => {
            /* ignore — expansion zoom fetch failed */
          });
      });

      // Single-marker click → bubble up via callback.
      map.on('click', 'photo-points', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        const id = f?.properties?.id;
        if (id != null) onMarkerClickRef.current?.(String(id));
      });

      // Cursor affordances.
      for (const layer of ['photo-clusters', 'photo-points']) {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      // Move-end → persist last state for Map → Globe reverse.
      map.on('moveend', () => {
        const c = map.getCenter();
        onMoveEndRef.current?.([c.lng, c.lat], map.getZoom());
      });

      setMapLoaded(true);
      onMapReadyRef.current?.();
    });

    return () => {
      setMapLoaded(false);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update markers when prop changes (and map is loaded) ──────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('photos') as GeoJSONSource | undefined;
    if (!source) return;
    const features = markers
      .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
      .map((m) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [m.lng, m.lat] as [number, number],
        },
        properties: {
          id: m.id,
          filename: m.filename ?? '',
          taken_at: m.taken_at ?? '',
        },
      }));
    source.setData({ type: 'FeatureCollection', features });
  }, [markers, mapLoaded]);

  // ── Resize observer — parent layout changes must call resize() ─
  // Otherwise MapLibre keeps rendering at the old canvas size
  // (visible as a blank or partial map).
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── MapLibre second-round fix (Frank #7914 spec §48): explicit
  // map.resize() at key lifecycle moments. ResizeObserver covers
  // container size changes from layout, but doesn't fire when
  // opacity transitions 0→1 — MapLibre's WebGL canvas can stay
  // at the last-known size and the first painted frame after
  // the crossfade lands at the wrong viewport. Calling resize()
  // when the map finishes loading catches the most common case
  // (initialization in a 0-size container, then transition reveals
  // it).
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current;
    if (!map) return;
    // Defer one frame so SpatialTransition's CSS opacity transition
    // has a chance to apply (otherwise the resize computes against
    // a still-transitioning container).
    const raf = requestAnimationFrame(() => {
      try {
        map.resize();
      } catch (err) {
        console.warn('[PhotoMap] resize() failed:', err);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [mapLoaded]);

  return (
    <div ref={containerRef} className={className} aria-hidden="true" />
  );
}
