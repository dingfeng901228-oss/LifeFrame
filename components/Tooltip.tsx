'use client';

import { useState, type ReactNode } from 'react';

/**
 * Frank #0906 round-14 cont.: minimal hover/focus tooltip.
 * Renders an absolutely-positioned label below the trigger on
 * mouse enter / focus; hides on mouse leave / blur. No portal,
 * no animation library — pure React + CSS.
 *
 * The tooltip is rendered inline (not in a portal) so it inherits
 * z-index / overflow from the trigger's parent. The trigger
 * element should be `position: relative` (set by the caller) or
 * we set it ourselves.
 */
type Props = {
  label: string;
  children: ReactNode;
  // 'top' (default) | 'bottom' — vertical placement relative to
  // the trigger.
  side?: 'top' | 'bottom';
};

export function Tooltip({ label, children, side = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#0a0e1a] px-2 py-1 text-[11px] font-normal text-white shadow-lg ${
            side === 'top'
              ? 'bottom-full mb-1.5'
              : 'top-full mt-1.5'
          }`}
        >
          {label}
          {/* Tiny triangle pointer (CSS border trick). Positioned
              per `side` so the triangle points at the trigger. */}
          <span
            aria-hidden="true"
            className={`absolute left-1/2 -translate-x-1/2 h-0 w-0 border-x-4 border-x-transparent ${
              side === 'top'
                ? 'top-full border-t-4 border-t-[#0a0e1a]'
                : 'bottom-full border-b-4 border-b-[#0a0e1a]'
            }`}
          />
        </span>
      )}
    </span>
  );
}