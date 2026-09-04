'use client';

import { useEffect, useReducer, useState } from 'react';
import { Globe, type GlobeMarker } from './Globe';
import { PhotoMap, type PhotoMapMarker } from './PhotoMap';
import { SpatialTransition } from './SpatialTransition';
import {
  createInitialSpatialState,
  spatialReducer,
} from './mapState';
import {
  MAP_TRANSITION_BEGIN,
  TRANSITION_DURATION_MS,
  globeScaleToMapZoom,
} from './mapConfig';
import { rotationToCenter } from '@/lib/globeCoords';

type Props = {
  /** Globe markers (lat/lng only — used for the d3 globe). */
  markers?: GlobeMarker[];
  /** Phase 4: PhotoMap markers (with id + photo info for popup/clicks). */
  photoMapMarkers?: PhotoMapMarker[];
  /** Pass-through to Globe: marker index → photos[i]. */
  onMarkerSelect?: (index: number) => void;
  /** Pass-through to Globe: cluster indices → cluster modal. */
  onClusterClick?: (indices: number[]) => void;
  /** Phase 4: PhotoMap single-marker click → photo detail. */
  onPhotoMarkerClick?: (id: string) => void;
};

/**
 * SpatialExplorer — Phase 4.
 *
 * Owns the spatial mode state machine and orchestrates the
 * Globe ↔ PhotoMap crossfade. Reads current Globe rotation/scale
 * from the reducer (fed by Globe's onRotationChange / onScaleChange
 * callbacks) and computes the matching MapLibre center/zoom so the
 * user's visual focus is preserved across the transition (spec §9–11).
 *
 * Trigger chain:
 *   globe.scale >= MAP_TRANSITION_BEGIN (2300)
 *     → ENTER_TRANSITION  (mode = 'transitioning')
 *     → SpatialTransition fades Globe 1→0, PhotoMap 0→1
 *     → PhotoMap.map.on('load') fires
 *     → COMPLETE_TRANSITION('map')  (mode = 'map')
 *
 * Phase 5 will add the reverse ("← 返回地球仪") button.
 */
export function SpatialExplorer({
  markers = [],
  photoMapMarkers = [],
  onMarkerSelect,
  onClusterClick,
  onPhotoMarkerClick,
}: Props) {
  const [state, dispatch] = useReducer(
    spatialReducer,
    undefined,
    createInitialSpatialState,
  );
  // PhotoMap basemap readiness — kept as React state (not in the
  // spatial reducer) because it's an internal PhotoMap lifecycle
  // event, not a user-driven transition trigger. The completion
  // effect below watches both this flag and state.mode to fire
  // COMPLETE_TRANSITION exactly once when the user has triggered
  // a transition AND the map is ready.
  const [mapReady, setMapReady] = useState(false);

  // Trigger the transition when the user wheels the Globe past
  // MAP_TRANSITION_BEGIN. ENTER_TRANSITION is idempotent in the
  // reducer (no-op if already transitioning), so the effect is safe
  // to re-fire while scale is above the threshold.
  useEffect(() => {
    if (
      state.mode === 'globe' &&
      state.globe.scale >= MAP_TRANSITION_BEGIN
    ) {
      dispatch({ type: 'ENTER_TRANSITION' });
    }
  }, [state.mode, state.globe.scale]);

  // Complete the transition when BOTH conditions hold:
  //   1. state.mode === 'transitioning' (user has triggered)
  //   2. mapReady === true (PhotoMap basemap.on('load') fired)
  // Either ordering works:
  //   - Map loads first, then user crosses threshold → effect
  //     fires when state.mode changes to 'transitioning'.
  //   - User crosses threshold first, then map loads → effect
  //     fires when mapReady flips to true.
  // Without this guard, the original "dispatch on onMapReady"
  // approach would fire COMPLETE_TRANSITION before ENTER_TRANSITION
  // (PhotoMap is mounted always → basemap can finish loading while
  // mode is still 'globe'), jumping straight to 'map' and skipping
  // the crossfade.
  useEffect(() => {
    if (state.mode === 'transitioning' && mapReady) {
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'map' });
    }
  }, [state.mode, mapReady]);

  // Compute PhotoMap's initial center/zoom from current Globe state.
  // rotationToCenter applies the d3-geo inverse (rotation → lng/lat);
  // globeScaleToMapZoom maps scale → MapLibre zoom. Both functions
  // live in lib/* and components/mapConfig.ts respectively.
  const mapCenter: [number, number] = (() => {
    const c = rotationToCenter(state.globe.rotation);
    return [c.lng, c.lat];
  })();
  const mapZoom = globeScaleToMapZoom(state.globe.scale);

  return (
    <SpatialTransition
      mode={state.mode}
      durationMs={TRANSITION_DURATION_MS}
      globe={
        <Globe
          markers={markers}
          onMarkerSelect={onMarkerSelect}
          onClusterClick={onClusterClick}
          onRotationChange={(rotation) =>
            dispatch({ type: 'GLOBE_ROTATION_CHANGED', rotation })
          }
          onScaleChange={(scale) =>
            dispatch({ type: 'GLOBE_SCALE_CHANGED', scale })
          }
        />
      }
      photoMap={
        <PhotoMap
          markers={photoMapMarkers}
          initialCenter={mapCenter}
          initialZoom={mapZoom}
          onMarkerClick={onPhotoMarkerClick}
          onMapReady={() => setMapReady(true)}
          onMoveEnd={(center, zoom) =>
            dispatch({ type: 'MAP_MOVE_END', center, zoom })
          }
        />
      }
    />
  );
}
