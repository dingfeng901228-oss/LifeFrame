/**
 * Frank #0906 round-13 (P2 #10): LifeFrame brand mark.
 *
 * Renders a small inline SVG logo — a stylized globe with a
 * photo marker — followed by the "LifeFrame" wordmark. Replaces
 * the previous text-only "LifeFrame" link in components/HomeLogo
 * .tsx.
 *
 * Why a globe + marker?
 *   - The product is a 3D photo globe at /, so the mark should
 *     hint at that on first glance.
 *   - The cyan marker is the same color the app uses for the
 *     playhead on the timeline and the photo dots on the globe
 *     itself, so the brand mark stays in the visual family.
 *
 * The mark is 24x24 in the header. The SVG uses currentColor so
 * the parent className controls the color (light mode: black,
 * dark mode: white). The cyan marker stays brand-colored in
 * both modes for brand consistency.
 */
export function LifeFrameLogoMark({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="LifeFrame"
    >
      {/* Globe outline */}
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Latitude line (horizontal across center) */}
      <line
        x1="3.5"
        y1="12"
        x2="20.5"
        y2="12"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.5"
      />
      {/* Longitude curve (vertical, slightly bowed) */}
      <path
        d="M12 3 Q7 12 12 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.5"
      />
      <path
        d="M12 3 Q17 12 12 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.5"
      />
      {/* Photo marker — the brand-colored dot. Positioned
          slightly off-center so it visually reads as a marker
          placed on a globe, not the geometric center. */}
      <circle
        cx="15"
        cy="9"
        r="2.25"
        fill="#06b6d4"
        stroke="white"
        strokeWidth="0.75"
      />
    </svg>
  );
}
