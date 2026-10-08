'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Frank #0906 round-14 cont.: top-of-page search input for
 * the Stats page. Filters the city cards list + the world map
 * by city name OR country name (case-insensitive). The matching
 * happens server-side already (the cards are pre-rendered),
 * so this just hides/shows them client-side — no refetch.
 */
type Props = {
  // Total counts shown next to the input as "X / Y cities".
  total: number;
  // DOM id of each card to toggle hidden attribute on.
  // Stored in a single ref array. We don't pass the list of
  // card ids down (would couple us to the page structure);
  // instead we auto-collect them on mount via the data-attr
  // emitted by the cards in app/stats/page.tsx.
  matchAttr?: string;
  // Same for the world map dots.
  dotMatchAttr?: string;
};

const STORAGE_KEY = 'lifeframe-stats-filter';

export function StatsSearch({ total }: Props) {
  const [query, setQuery] = useState<string>('');
  const [matchAttr] = useState<string>('data-stats-loc');
  const [dotMatchAttr] = useState<string>('data-stats-country');

  // Restore last filter from localStorage (UX continuity).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved != null) setQuery(saved);
    } catch {
      // ignore
    }
  }, []);

  // Apply the filter by toggling the `hidden` attribute on the
  // matched card elements and dimming the world map dots. We do
  // this in a single effect that walks the DOM rather than
  // piping state into each card, so StatsPage stays a server
  // component and the cards don't re-render on every keystroke.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    try {
      window.localStorage.setItem(STORAGE_KEY, query);
    } catch {
      // ignore
    }
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(`[${matchAttr}]`),
    );
    let shown = 0;
    for (const el of cards) {
      const haystack = el.getAttribute(matchAttr) ?? '';
      const hit = q === '' || haystack.toLowerCase().includes(q);
      el.hidden = !hit;
      if (hit) shown += 1;
    }
    const dots = Array.from(
      document.querySelectorAll<SVGElement>(`[${dotMatchAttr}]`),
    );
    for (const dot of dots) {
      const haystack = dot.getAttribute(dotMatchAttr) ?? '';
      const hit = q === '' || haystack.toLowerCase().includes(q);
      dot.style.opacity = hit ? '1' : '0.2';
    }
    // Tally counter — count of currently visible cards.
    const tally = document.getElementById('stats-search-tally');
    if (tally) {
      tally.textContent = q === ''
        ? `${total} 座城市`
        : `${shown} / ${total} 座匹配`;
    }
  }, [query, total, matchAttr, dotMatchAttr]);

  // Build a tiny debounced prop change so the live region
  // announcement doesn't thrash on every keystroke.
  const [announce, setAnnounce] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim() === '') {
        setAnnounce(`显示全部 ${total} 座城市`);
      } else {
        const shown = Array.from(
          document.querySelectorAll<HTMLElement>('[data-stats-loc]'),
        ).filter((el) => !el.hidden).length;
        setAnnounce(`${shown} / ${total} 座城市匹配 "${query.trim()}"`);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query, total]);

  const placeholder = useMemo(
    () => '🔍 输入城市或国家名…',
    [],
  );

  return (
    <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <div className="relative flex-1">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label="搜索城市或国家"
          className="min-h-[44px] w-full rounded-full border border-black/15 bg-white/[0.04] px-4 pr-10 text-sm text-black placeholder-black/40 focus:border-black/40 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder-white/40 dark:focus:border-white/40"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="清除搜索"
            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full text-black/50 transition hover:bg-black/10 hover:text-black dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
          >
            ×
          </button>
        )}
      </div>
      <p
        id="stats-search-tally"
        aria-live="polite"
        className="text-sm tabular-nums text-[var(--text-muted)] sm:whitespace-nowrap"
      >
        {total} 座城市
      </p>
      <span className="sr-only" role="status">
        {announce}
      </span>
    </div>
  );
}