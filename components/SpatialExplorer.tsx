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
 * SpatialExplorer — Phase 5.
 *
 * Owns the spatial mode state machine and orchestrates the
 * Globe ↔ PhotoMap crossfade in both directions:
 *
 *   Forward (Phase 4, scale-driven):
 *     globe.scale >= MAP_TRANSITION_BEGIN (2300)
 *       → ENTER_TRANSITION  (pendingTarget = 'map')
 *       → SpatialTransition fades Globe 1→0, PhotoMap 0→1
 *       → PhotoMap.map.on('load') fires
 *       → COMPLETE_TRANSITION('map')
 *
 *   Reverse (Phase 5, button-driven):
 *     user clicks "← 返回地球仪"
 *       → ENTER_TRANSITION  (pendingTarget = 'globe')
 *       → SpatialTransition fades Globe 0→1, PhotoMap 1→0
 *       → setTimeout(TRANSITION_DURATION_MS)
 *       → COMPLETE_TRANSITION('globe')
 *
 * Spec §31–32: returning to Globe restores state.globe.rotation +
 * state.globe.scale (we kept these in the reducer throughout the
 * forward transition), so the user lands back where they were.
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
  // PhotoMap basemap readiness — separate React state because it's
  // an internal PhotoMap lifecycle event, not a user-driven
  // transition trigger. The completion effect below watches both
  // this flag and state.mode to fire COMPLETE_TRANSITION exactly
  // once when the user has triggered a transition AND the map is
  // ready (forward direction only — reverse uses setTimeout).
  const [mapReady, setMapReady] = useState(false);

  // Forward trigger: scale crosses MAP_TRANSITION_BEGIN.
  // ENTER_TRANSITION is idempotent in the reducer.
  useEffect(() => {
    if (
      state.mode === 'globe' &&
      state.globe.scale >= MAP_TRANSITION_BEGIN
    ) {
      dispatch({ type: 'ENTER_TRANSITION' });
    }
  }, [state.mode, state.globe.scale]);

  // Forward completion: only when the user triggered a forward
  // transition (pendingTarget === 'map') AND the map is ready.
  // Either ordering works:
  //   - Map loads first, then user crosses threshold → effect
  //     fires when state.mode changes to 'transitioning'.
  //   - User crosses threshold first, then map loads → effect
  //     fires when mapReady flips to true.
  // Without the pendingTarget guard, a reverse transition
  // (Phase 5) would also fire COMPLETE_TRANSITION('map') on
  // mapReady flipping — premature completion to 'map' when the
  // user actually wanted to return to 'globe'.
  useEffect(() => {
    if (state.mode === 'transitioning' && mapReady && state.pendingTarget === 'map') {
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'map' });
    }
  }, [state.mode, mapReady, state.pendingTarget]);

  // Reverse completion: when entering reverse transition
  // (pendingTarget === 'globe'), wait one CSS transition cycle
  // then dispatch COMPLETE_TRANSITION('globe'). The CSS opacity
  // animation runs in parallel; the user sees Globe fade in +
  // PhotoMap fade out, then Globe is fully visible.
  useEffect(() => {
    if (state.mode !== 'transitioning' || state.pendingTarget !== 'globe') return;
    const timer = setTimeout(() => {
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'globe' });
    }, TRANSITION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [state.mode, state.pendingTarget]);

  // Compute PhotoMap's initial center/zoom from current Globe state.
  // rotationToCenter applies the d3-geo inverse (rotation → lng/lat);
  // globeScaleToMapZoom maps scale → MapLibre zoom.
  const { lng, lat } = rotationToCenter(state.globe.rotation);
  const mapCenter: [number, number] = [lng, lat];
  const mapZoom = globeScaleToMapZoom(state.globe.scale);

  return (
    <SpatialTransition
      mode={state.mode}
      pendingTarget={state.pendingTarget}
      durationMs={TRANSITION_DURATION_MS}
      onRequestGlobe={() => dispatch({ type: 'ENTER_TRANSITION' })}
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
