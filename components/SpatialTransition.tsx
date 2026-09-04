'use client';

import type { ReactNode } from 'react';
import type { SpatialViewMode } from './mapState';

type Props = {
  globe: ReactNode;
  photoMap: ReactNode;
  mode: SpatialViewMode;
  /**
   * Phase 5: where the current transition is heading. Used to
   * determine final opacities during 'transitioning' so the
   * reverse (Map → Globe) crossfade animates Globe 0→1 + PhotoMap
   * 1→0 instead of the forward direction.
   */
  pendingTarget: 'globe' | 'map' | null;
  durationMs?: number;
  /** Phase 5: fires when user clicks "← 返回地球仪". */
  onRequestGlobe?: () => void;
};

/**
 * Phase 5: opacity crossfade layer between Globe and PhotoMap.
 *
 * Both children are always mounted (Phase 5: reverse transition
 * needs Globe to be present for the fade-in; removing it on 'map'
 * mode would cause a remount flash during the reverse crossfade).
 * Visibility is opacity + CSS `visibility`; WebGL stays warm.
 *
 * Opacity targets during 'transitioning' are decided by pendingTarget:
 *   pendingTarget='map'    → globe→0, photoMap→1 (forward)
 *   pendingTarget='globe'  → globe→1, photoMap→0 (reverse)
 * CSS transitions both directions over `durationMs`.
 */
export function SpatialTransition({
  globe,
  photoMap,
  mode,
  pendingTarget,
  durationMs = 650,
  onRequestGlobe,
}: Props) {
  // Compute target opacities. During 'transitioning', pendingTarget
  // decides the destination; otherwise the current mode does.
  const targetIsGlobe = mode === 'globe' || pendingTarget === 'globe';
  const targetIsMap = mode === 'map' || pendingTarget === 'map';

  const globeOpacity = targetIsGlobe ? 1 : 0;
  const photoMapOpacity = targetIsMap ? 1 : 0;
  // Hide PhotoMap via visibility (not display:none) when fully
  // off-screen, so the WebGL canvas remains mounted but isn't
  // hit-testable.
  const photoMapVisibility =
    photoMapOpacity > 0 ? 'visible' : 'hidden';

  return (
    <div className="relative h-full w-full">
      <div
        className="absolute inset-0"
        style={{
          opacity: globeOpacity,
          transition: `opacity ${durationMs}ms ease-in-out`,
        }}
      >
        {globe}
      </div>
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
      {/* Phase 5: reverse-transition button — only visible when the
          user is fully in Map mode (not during a forward transition
          or already returning). */}
      {mode === 'map' && onRequestGlobe && (
        <button
          type="button"
          onClick={onRequestGlobe}
          aria-label="返回地球仪"
          className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-sm text-white shadow-lg backdrop-blur transition hover:bg-black/80"
        >
          ← 返回地球仪
        </button>
      )}
    </div>
  );
}
