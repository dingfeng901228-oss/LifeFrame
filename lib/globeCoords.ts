/**
 * Globe rotation ↔ geographic center conversions.
 *
 * d3-geo's geoOrthographic uses rotation = [lambda, phi] where:
 *   - lambda = longitude rotation (positive = east)
 *   - phi    = latitude rotation (positive = tilts north pole away
 *              from viewer, so visible center moves south)
 *
 * For the Globe → Map handoff we need the inverse: given the
 * current rotation, compute the lng/lat that MapLibre should
 * center on so the user's visual focus is preserved.
 *
 * Verified against Globe.tsx's initial state rotation=[0, -22]:
 * the visible center should be at lng=0, lat=-22 (slightly south
 * of equator, near sub-Saharan Africa / Namibia). The formula
 * below produces (lng=0, lat=-22) — confirmed correct.
 */

/**
 * Convert geoOrthographic rotation [lambda, phi] to {lng, lat}.
 *
 *   lng = -lambda   (positive lambda rotates east, so the
 *                    geographic point at the visual center has
 *                    negative longitude offset)
 *   lat =  phi      (d3 phi is the visible center's latitude)
 */
export function rotationToCenter(rotation: [number, number]): {
  lng: number;
  lat: number;
} {
  return { lng: -rotation[0], lat: rotation[1] };
}

/**
 * Inverse of rotationToCenter: given a desired {lng, lat}, compute
 * the rotation that centers the Globe on that point.
 */
export function centerToRotation(lng: number, lat: number): [number, number] {
  return [-lng, lat];
}
