/**
 * PhotoMap + Globe→Map transition constants.
 *
 * Single source of truth for thresholds, zoom mappings, and the
 * basemap style URL. Per spec §7, transition numbers live here,
 * not hardcoded inside components.
 */

// Basemap. OpenFreeMap is free, no API key, dark style matches
// LifeFrame's minimal aesthetic (spec §45). Spec §44 forbids
// Mapbox logo — OpenFreeMap is OSM-based and renders OSM-style
// attribution via MapLibre's compact attribution control.
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

// Default center/zoom before the Globe handoff arrives.
// Phase 3+ will overwrite via initialCenter/initialZoom props.
export const DEFAULT_MAP_CENTER: [number, number] = [0, 20];
export const DEFAULT_MAP_ZOOM = 2;

// GeoJSON clustering (MapLibre built-in).
// clusterMaxZoom=14 — above this, clusters expand to individuals.
// clusterRadius=50px — markers within 50px on screen merge.
export const CLUSTER_MAX_ZOOM = 14;
export const CLUSTER_RADIUS = 50;

// Globe scale → MapLibre zoom mapping (spec §11).
// Initial estimates; Phase 4 will fine-tune by visual diff.
// Brackets chosen so the map "feels" continuous as the Globe
// approaches its MAX_SCALE=2400 ceiling.
export function globeScaleToMapZoom(scale: number): number {
  if (scale <= 400) return 2;
  if (scale <= 800) return 3.5;
  if (scale <= 1500) return 5.5;
  if (scale <= 2400) return 7.5;
  return 7.5;
}

// Globe → Map transition thresholds (spec §7).
//   scale >= MAP_TRANSITION_START  → start preloading PhotoMap
//   scale >= MAP_TRANSITION_BEGIN  → start opacity crossfade
//   scale == MAP_TRANSITION_END    → PhotoMap fully shown
//
// MapLibre second-round fix (Frank #7914): MAP_TRANSITION_BEGIN
// bumped from 2300 → 2350 to widen the hysteresis gap between
// forward (Globe scale) and reverse (Map zoom) thresholds. The
// old MAP_FULL_REVERSE = 2400 used Globe scale, which is
// meaningless when the user is already in Map mode (Globe scale
// can't change there) — replaced by MAP_TO_GLOBE_ZOOM below so
// the reverse trigger fires on the user's actual MapLibre zoom.
export const MAP_TRANSITION_START = 2100;
export const MAP_TRANSITION_BEGIN = 2350;
export const MAP_TRANSITION_END = 2400;

// Reverse threshold (Map → Globe). MapLibre zoom ≤ 3 means the
// user has zoomed out far enough that the world view is back to
// "country scale" — at that point the Globe gives them a
// equivalent (or better) mental model and the crossfade back is
// natural. Using a separate value from MAP_TRANSITION_BEGIN
// (Globe scale 2350) creates the hysteresis Frank called out in
// #7914: "防止 Globe → Map → Globe → Map 无限循环".
export const MAP_TO_GLOBE_ZOOM = 3;

// Transition animation duration in ms (spec §13).
// Recommended 650ms — long enough to feel intentional, short
// enough not to make the user wait.
export const TRANSITION_DURATION_MS = 650;
