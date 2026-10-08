'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Frank #0906 round-14 (Batch C + 14 continuation): collapsible
 * group header + body. Default collapsed (so the Stats page fits
 * one screen on desktop). The first group is auto-opened so the
 * page doesn't read as "all closed" on first paint.
 *
 * Each card anchors itself by id so the WorldDotMap onSelect
 * handler can call
 * `document.getElementById(...)?.scrollIntoView({ behavior: 'smooth' })`.
 *
 * Renamed from `CollapseCountryButton` to `CollapseGroupButton`
 * (round-14): the card hierarchy is now city-first (each card is
   one city, with country as a small subtitle), so the button
   title prop alone is enough — no hard-coded country wording.
 */
type Props = {
  title: string;
  subtitle?: string;
  total: number;
  itemCount?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function CollapseGroupButton({
  title,
  subtitle,
  total,
  itemCount,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement | null>(null);

  // External "expand me" signal: when the user clicks a country
  // dot on the world map we want the matching card to expand
  // + scroll into view. The Stats page (server component) can't
  // directly call a client handler, so we listen on a custom
  // DOM event the map dispatches on window.
  useEffect(() => {
    function onExpand(e: Event) {
      const target = e as CustomEvent<{ country: string }>;
      if (target.detail?.country !== title) return;
      setOpen(true);
      requestAnimationFrame(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    window.addEventListener('lifeframe:expand-country', onExpand as EventListener);
    return () =>
      window.removeEventListener('lifeframe:expand-country', onExpand as EventListener);
  }, [title]);

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-3 px-5 py-3 text-left transition hover:bg-white/[0.04]"
      >
        <span className="flex items-baseline gap-3">
          <span
            className={`text-[var(--text-muted)] transition-transform ${
              open ? 'rotate-90' : ''
            }`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="flex flex-col gap-0">
            <span className="text-base font-medium text-[var(--text-primary)]">
              {title}
            </span>
            {subtitle && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {subtitle}
              </span>
            )}
          </span>
        </span>
        <span className="flex items-baseline gap-3 text-sm tabular-nums text-[var(--text-muted)]">
          {itemCount && <span>{itemCount}</span>}
          <span>{total} 张</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-5 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

/** Convenience: dispatch the expand event the cards listen for.
 *  Used by the world map's onSelect. */
export function expandCountryCard(country: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('lifeframe:expand-country', { detail: { country } }),
  );
}
