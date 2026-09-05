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
  MAP_TO_GLOBE_ZOOM,
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
 * SpatialExplorer — MapLibre second-round (Frank #7914).
 *
 * Owns the spatial mode state machine and orchestrates the
 * Globe ↔ PhotoMap crossfade in both directions. State machine
 * is now 4-mode per Frank spec:
 *
 *   'globe' | 'transitioning-to-map' | 'map' | 'transitioning-to-globe'
 *
 * Triggers:
 *
 *   Forward (scale-driven, Frank #7914 spec §31):
 *     globe.scale >= MAP_TRANSITION_BEGIN (2350) in mode='globe'
 *       → ENTER_TRANSITION  (mode → 'transitioning-to-map')
 *       → SpatialTransition fades Globe 1→0, PhotoMap 0→1
 *       → PhotoMap.onMapReady() fires
 *       → COMPLETE_TRANSITION('map')
 *
 *   Reverse (zoom-driven, Frank #7914 spec §32):
 *     map.zoom <= MAP_TO_GLOBE_ZOOM (3) in mode='map'
 *       → ENTER_TRANSITION  (mode → 'transitioning-to-globe')
 *       → SpatialTransition fades Globe 0→1, PhotoMap 1→0
 *       → setTimeout(TRANSITION_DURATION_MS)
 *       → COMPLETE_TRANSITION('globe')
 *
 *   Reverse (button-driven):
 *     user clicks "← 返回地球仪"
 *       → ENTER_TRANSITION  (mode → 'transitioning-to-globe')
 *       → same path as zoom-driven reverse
 *
 * Hysteresis: forward uses Globe scale 2350, reverse uses Map
 * zoom 3. The gap prevents Globe → Map → Globe → Map oscillation
 * at the boundary. Per Frank #7914: "防止 Globe → Map → Globe →
 * Map 无限循环".
 *
 * Error fallback (Frank #7914 spec §47-52): if PhotoMap reports
 * a fatal error (style load fail, canvas size 0, etc.) during a
 * forward transition, force-complete the transition back to
 * 'globe' so the user is never stranded on a black screen +
 * attribution-only state.
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
  // MapLibre error flag (Frank #7914 spec §47-52). Set by
  // PhotoMap's error handler; triggers the fallback effect above
  // to force-complete any in-flight transition back to 'globe'.
  // Reset to false on a successful map load so the next transition
  // can proceed normally.
  const [mapError, setMapError] = useState<string | null>(null);

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
  // transition (mode === 'transitioning-to-map') AND the map is
  // ready. Either ordering works:
  //   - Map loads first, then user crosses threshold → effect
  //     fires when state.mode changes to 'transitioning-to-map'.
  //   - User crosses threshold first, then map loads → effect
  //     fires when mapReady flips to true.
  // Without the explicit mode-name check, a reverse transition
  // would also fire COMPLETE_TRANSITION('map') on mapReady
  // flipping — premature completion to 'map' when the user
  // actually wanted to return to 'globe'.
  useEffect(() => {
    if (
      state.mode === 'transitioning-to-map' &&
      mapReady &&
      state.pendingTarget === 'map'
    ) {
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'map' });
    }
  }, [state.mode, mapReady, state.pendingTarget]);

  // Reverse trigger (Frank #7914 spec §32, §35): MapLibre zoom
  // crossing MAP_TO_GLOBE_ZOOM while in 'map' mode initiates the
  // reverse transition. Previously this only fired on the
  // "← 返回地球仪" button click — without an automatic zoom-based
  // trigger the user was stuck on a black Map screen if they
  // scrolled out far enough (the symptom Frank reported).
  //
  // Guard: only fire when state.mode === 'map' (no transition in
  // flight). ENTER_TRANSITION is idempotent but skipping the
  // dispatch during transition keeps the reducer's invariants
  // obvious to readers.
  useEffect(() => {
    if (state.mode === 'map' && state.map.zoom <= MAP_TO_GLOBE_ZOOM) {
      dispatch({ type: 'ENTER_TRANSITION' });
    }
  }, [state.mode, state.map.zoom]);

  // Reverse completion: when entering reverse transition
  // (mode === 'transitioning-to-globe'), wait one CSS transition
  // cycle then dispatch COMPLETE_TRANSITION('globe'). The CSS
  // opacity animation runs in parallel; the user sees Globe fade
  // in + PhotoMap fade out, then Globe is fully visible.
  useEffect(() => {
    if (state.mode !== 'transitioning-to-globe') return;
    const timer = setTimeout(() => {
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'globe' });
    }, TRANSITION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [state.mode]);

  // Error fallback (Frank #7914 spec §47-52): if PhotoMap reports
  // a fatal error during a forward transition, force-complete back
  // to 'globe' so the user is never stranded on a black Map
  // screen. Without this, a style/tile load failure during the
  // crossfade leaves PhotoMap opacity=1 with no content + Globe
  // opacity=0 — i.e. exactly the "黑屏 + OpenFreeMap attribution
  // 无法返回" failure Frank described.
  useEffect(() => {
    if (
      mapError &&
      (state.mode === 'transitioning-to-map' ||
        state.mode === 'transitioning-to-globe')
    ) {
      // Force-complete to whichever side is safer. Globe is
      // always reachable (Globe.tsx is unconditionally mounted)
      // and never needs external state to render, so it's the
      // safer destination in any error path.
      dispatch({ type: 'COMPLETE_TRANSITION', target: 'globe' });
    }
  }, [mapError, state.mode]);

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
          onMapReady={() => {
            setMapReady(true);
            setMapError(null);
          }}
          onMapError={(message) => setMapError(message)}
          onMoveEnd={(center, zoom) =>
            dispatch({ type: 'MAP_MOVE_END', center, zoom })
          }
        />
      }
    />
  );
}
