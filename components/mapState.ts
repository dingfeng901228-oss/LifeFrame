/**
 * SpatialView state machine.
 *
 * Owns the unified state for Globe ↔ MapLibre. Phase 3 skeleton:
 * the reducer is in place, mode can be set, and SpatialExplorer
 * dispatches updates. Phase 4 wires the actual transition trigger
 * (scale → preload → crossfade); Phase 5 wires the reverse.
 */

export type SpatialViewMode = 'globe' | 'transitioning' | 'map';

/** Globe's d3-geo rotation [lambda, phi] + projection scale. */
export type GlobeState = {
  rotation: [number, number];
  scale: number;
};

/** MapLibre map center [lng, lat] + zoom. */
export type MapState = {
  center: [number, number];
  zoom: number;
};

export type SpatialViewState = {
  mode: SpatialViewMode;
  globe: GlobeState;
  map: MapState;
};

export type SpatialViewAction =
  /** Fired by Globe's drag handler — keeps rotation in sync. */
  | { type: 'GLOBE_ROTATION_CHANGED'; rotation: [number, number] }
  /** Fired by Globe's wheel handler — scale drives the transition. */
  | { type: 'GLOBE_SCALE_CHANGED'; scale: number }
  /** Start the transition (Phase 4 will trigger this automatically). */
  | { type: 'ENTER_TRANSITION' }
  /** Finish the transition (Phase 4 calls on map.on('load')). */
  | { type: 'COMPLETE_TRANSITION'; target: 'globe' | 'map' }
  /** Fired by PhotoMap's moveend — keeps map state in sync. */
  | {
      type: 'MAP_MOVE_END';
      center: [number, number];
      zoom: number;
    }
  /** User clicks "← 返回地球仪" (Phase 5 wires the button). */
  | { type: 'REQUEST_GLOBE' }
  /** Internal — used by tests to force-jump modes. */
  | { type: 'REQUEST_MAP' };

/**
 * Initial state matches Globe.tsx's useState defaults so SpatialExplorer
 * mounts with no visual flicker on first render.
 */
export function createInitialSpatialState(): SpatialViewState {
  return {
    mode: 'globe',
    globe: { rotation: [0, -22], scale: 360 },
    map: { center: [0, 20], zoom: 2 },
  };
}

export function spatialReducer(
  state: SpatialViewState,
  action: SpatialViewAction,
): SpatialViewState {
  switch (action.type) {
    case 'GLOBE_ROTATION_CHANGED':
      return {
        ...state,
        globe: { ...state.globe, rotation: action.rotation },
      };
    case 'GLOBE_SCALE_CHANGED':
      return {
        ...state,
        globe: { ...state.globe, scale: action.scale },
      };
    case 'ENTER_TRANSITION':
      // No-op if already transitioning (idempotent).
      return state.mode === 'transitioning'
        ? state
        : { ...state, mode: 'transitioning' };
    case 'COMPLETE_TRANSITION':
      return { ...state, mode: action.target };
    case 'MAP_MOVE_END':
      return {
        ...state,
        map: { center: action.center, zoom: action.zoom },
      };
    case 'REQUEST_GLOBE':
      // Phase 5 will set mode='transitioning' first (reverse), then
      // 'globe' on completion. Phase 3 just sets mode directly so
      // the state-machine plumbing is in place.
      return { ...state, mode: 'globe' };
    case 'REQUEST_MAP':
      return { ...state, mode: 'map' };
    default:
      return state;
  }
}
