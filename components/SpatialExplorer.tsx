'use client';

import { useReducer } from 'react';
import { Globe, type GlobeMarker } from './Globe';
import {
  createInitialSpatialState,
  spatialReducer,
} from './mapState';

type Props = {
  markers?: GlobeMarker[];
  /** Pass-through to Globe: index → photos[i] → photo detail. */
  onMarkerSelect?: (index: number) => void;
  /** Pass-through to Globe: cluster indices → cluster modal. */
  onClusterClick?: (indices: number[]) => void;
};

/**
 * SpatialExplorer — Phase 3 skeleton.
 *
 * State machine owner for the Globe ↔ MapLibre transition. Renders
 * Globe always (Phase 3); Phase 4 adds the SpatialTransition layer
 * + PhotoMap mount. The reducer is in place and dispatches flow
 * through, so Phase 4 only needs to wire the transition trigger
 * (scale >= MAP_TRANSITION_BEGIN → ENTER_TRANSITION).
 *
 * The Globe is wrapped, not replaced — HomeGallery's marker / click
 * logic stays in HomeGallery and is passed through these props.
 */
export function SpatialExplorer({
  markers = [],
  onMarkerSelect,
  onClusterClick,
}: Props) {
  const [state, dispatch] = useReducer(
    spatialReducer,
    undefined,
    createInitialSpatialState,
  );

  // Phase 3: render Globe always. Phase 4 will hide Globe (opacity 0)
  // and show PhotoMap during 'transitioning' mode, then unmount Globe
  // when mode === 'map'.
  return (
    <div className="relative h-full w-full">
      {state.mode !== 'map' && (
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
      )}
      {/* Phase 4 placeholder — SpatialTransition + PhotoMap will mount
          here and consume state.mode / state.map for crossfade. */}
      {state.mode === 'map' && (
        <div className="absolute inset-0 flex items-center justify-center text-sm opacity-50">
          Phase 4 will mount PhotoMap here.
        </div>
      )}
    </div>
  );
}
