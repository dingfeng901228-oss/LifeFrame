'use client';

import type { ReactNode } from 'react';
import type { SpatialViewMode } from './mapState';

type Props = {
  globe: ReactNode;
  photoMap: ReactNode;
  mode: SpatialViewMode;
  durationMs?: number;
};

/**
 * Phase 4: opacity crossfade layer between Globe and PhotoMap.
 *
 * Both children are always mounted (PhotoMap preloads while Globe
 * is still showing — spec §12). Visibility is opacity + CSS
 * `visibility` rather than display:none, so the WebGL context stays
 * warm across the crossfade and MapLibre's tile cache survives
 * the transition.
 *
 * Globe is unmounted when mode === 'map' to release its d3 SVG
 * resources; PhotoMap is never unmounted (would lose tile cache
 * and require re-loading on next transition).
 *
 * Phase 5 adds the reverse ("← 返回地球仪") button + reverse
 * transition; for now direction is one-way.
 */
export function SpatialTransition({
  globe,
  photoMap,
  mode,
  durationMs = 650,
}: Props) {
  // Globe: visible in 'globe' mode, fade to 0 during 'transitioning',
  // unmount in 'map' mode.
  const showGlobe = mode !== 'map';
  const globeOpacity = mode === 'globe' ? 1 : 0;

  // PhotoMap: hidden (visibility) + 0 opacity in 'globe' mode, fade
  // to 1 during 'transitioning', fully visible in 'map' mode.
  // visibility:hidden (not display:none) keeps the WebGL canvas
  // mounted and pre-warmed.
  const photoMapOpacity = mode === 'globe' ? 0 : 1;
  const photoMapVisibility = mode === 'globe' ? 'hidden' : 'visible';

  return (
    <div className="relative h-full w-full">
      {showGlobe && (
        <div
          className="absolute inset-0"
          style={{
            opacity: globeOpacity,
            transition: `opacity ${durationMs}ms ease-in-out`,
          }}
        >
          {globe}
        </div>
      )}
      <div
        className="absolute inset-0"
        style={{
          opacity: photoMapOpacity,
          visibility: photoMapVisibility,
          transition: `opacity ${durationMs}ms ease-in-out`,
        }}
      >
        {photoMap}
      </div>
    </div>
  );
}
