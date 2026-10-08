'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Frank #0906 round-14 (Batch C): collapsible country card
 * header + body. Default collapsed (so the Stats page fits one
 * screen on desktop). The first country is auto-opened so the
 * page doesn't read as "all closed" on first paint.
 *
 * Each card anchors itself by id (e.g. `country-中国`) so the
 * WorldDotMap onSelect handler can call
 * `document.getElementById(...)?.scrollIntoView({ behavior: 'smooth' })`.
 */
type Props = {
  title: string;
  total: number;
  cityCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function CollapseCountryButton({
  title,
  total,
  cityCount,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDivElement | null>(null);

  // External "expand me" signal: when the user clicks a country
  // dot on the world map we want the card to expand + scroll into
  // view. The Stats page (server component) can't directly call a
  // client handler, so we listen on a custom DOM event the map
  // dispatches on window. Decoupling keeps the map and the card
  // siblings rather than parent/child.
  useEffect(() => {
    function onExpand(e: Event) {
      const target = e as CustomEvent<{ country: string }>;
      if (target.detail?.country !== title) return;
      setOpen(true);
      // Wait a frame so the body has been rendered before scrolling.
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
        className="flex w-full items-baseline justify-between gap-3 px-5 py-3 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      >
        <span className="flex items-baseline gap-3">
          <span
            className={`text-black/40 transition-transform dark:text-white/40 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <span className="text-base font-medium text-black dark:text-white">
            {title}
          </span>
        </span>
        <span className="flex items-baseline gap-3 text-sm tabular-nums text-black/40 dark:text-white/40">
          {cityCount > 1 && (
            <span>{cityCount} 座城市</span>
          )}
          <span>{total} 张</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-black/10 px-5 py-3 dark:border-white/10">
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