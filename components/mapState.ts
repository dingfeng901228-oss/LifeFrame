/**
 * SpatialView state machine.
 *
 * Owns the unified state for Globe ↔ MapLibre. Phase 3 skeleton:
 * the reducer is in place, mode can be set, and SpatialExplorer
 * dispatches updates. Phase 4 wires the actual transition trigger
 * (scale → preload → crossfade); Phase 5 wires the reverse.
 */

export type SpatialViewMode =
  | 'globe'
  | 'transitioning-to-map'
  | 'map'
  | 'transitioning-to-globe';

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
  /**
   * Phase 5: where the current transition is heading.
   * `null` when mode is 'globe' or 'map' (no transition in flight).
   * Set by ENTER_TRANSITION based on the current mode; consumed
   * by COMPLETE_TRANSITION and SpatialTransition's opacity logic.
   */
  pendingTarget: 'globe' | 'map' | null;
  globe: GlobeState;
  map: MapState;
};

export type SpatialViewAction =
  /** Fired by Globe's drag handler — keeps rotation in sync. */
  | { type: 'GLOBE_ROTATION_CHANGED'; rotation: [number, number] }
  /** Fired by Globe's wheel handler — scale drives the transition. */
  | { type: 'GLOBE_SCALE_CHANGED'; scale: number }
  /**
   * Phase 5: start a transition. Reducer infers target from current
   * mode — 'globe' → target 'map', 'map' → target 'globe'. This
   * lets the same action cover both forward (scale-driven) and
   * reverse (button-driven) transitions.
   */
  | { type: 'ENTER_TRANSITION' }
  /** Finish the transition (Phase 4: map.on('load'); Phase 5: setTimeout). */
  | { type: 'COMPLETE_TRANSITION'; target: 'globe' | 'map' }
  /** Fired by PhotoMap's moveend — keeps map state in sync. */
  | {
      type: 'MAP_MOVE_END';
      center: [number, number];
      zoom: number;
    }
  /** Internal — used by tests to force-jump modes. */
  | { type: 'REQUEST_MAP' };

/**
 * Initial state matches Globe.tsx's useState defaults so SpatialExplorer
 * mounts with no visual flicker on first render.
 */
export function createInitialSpatialState(): SpatialViewState {
  return {
    mode: 'globe',
    pendingTarget: null,
    globe: { rotation: [0, -22], scale: 360 },
    map: { center: [0, 20], zoom: 2 },
  };
}

/**
 * MapLibre second-round fix (Frank #7914): SpatialExplorer still
 * sets `mode` to 'globe' | 'transitioning' | 'map' from the old
 * reducer signature (SpatialExplorer.tsx reads state.mode === 'globe'
 * / 'map' for forward + reverse triggers, and reads
 * state.mode === 'transitioning' to gate the auto-complete timeout).
 * We map those three legacy values onto the new 4-name mode here
 * so the rest of the codebase keeps compiling. New code paths
 * should compare against the full 4-name mode.
 */
export function legacyMode(mode: SpatialViewMode): 'globe' | 'transitioning' | 'map' {
  if (mode === 'transitioning-to-map' || mode === 'transitioning-to-globe') {
    return 'transitioning';
  }
  return mode as 'globe' | 'map';
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
    case 'ENTER_TRANSITION': {
      // Idempotent — no-op if already transitioning (either direction).
      if (state.mode === 'transitioning-to-map' || state.mode === 'transitioning-to-globe') {
        return state;
      }
      // MapLibre second-round fix (Frank #7914): explicit mode
      // names per spec — 'globe'|'transitioning-to-map'|'map'|
      // 'transitioning-to-globe'. Target direction baked into
      // the mode name so SpatialTransition can read it without
      // cross-checking pendingTarget.
      if (state.mode === 'globe') {
        return {
          ...state,
          mode: 'transitioning-to-map',
          pendingTarget: 'map',
        };
      }
      // state.mode === 'map' → reverse transition.
      return {
        ...state,
        mode: 'transitioning-to-globe',
        pendingTarget: 'globe',
      };
    }
    case 'COMPLETE_TRANSITION':
      return {
        ...state,
        mode: action.target,
        pendingTarget: null,
      };
    case 'MAP_MOVE_END':
      return {
        ...state,
        map: { center: action.center, zoom: action.zoom },
      };
    case 'REQUEST_MAP':
      return { ...state, mode: 'map', pendingTarget: null };
    default:
      return state;
  }
}
