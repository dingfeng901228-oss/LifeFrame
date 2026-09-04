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
  const onMoveEndRef = useRef(onMoveEnd);
  onMarkerClickRef.current = onMarkerClick;
  onMapReadyRef.current = onMapReady;
  onMoveEndRef.current = onMoveEnd;

  // ── Init map (run once on mount) ──────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;

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
    map.on('error', (e: MlErrorEvent) => {
      // eslint-disable-next-line no-console
      console.error(
        '[PhotoMap] MapLibre error:',
        e?.error?.message ?? e,
      );
    });

    map.on('load', () => {
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

  return (
    <div ref={containerRef} className={className} aria-hidden="true" />
  );
}
