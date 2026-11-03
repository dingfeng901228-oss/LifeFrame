'use client';

// Frank #7243 round-4: the "On This Day" card.
//
// Borrowed from OldMapsOnline / TimeMap, which made this a headline
// feature (their Jan 2026 release called it "a daily time machine"
// — every day surfaces what happened on this date). LifeFrame
// already computed the data (`onThisDayGrouped` in HomeGallery) but
// kept it behind a button + modal, so the single most emotional
// thing the archive can show you required a click to discover.
//
// The card sits in the controls strip under the Globe and shows the
// day's photos inline: a horizontally scrollable strip of thumbnails,
// each tagged with its year, ordered newest year first.
//
// Design notes:
//   - The strip is horizontally scrollable rather than a grid: the
//     number of photos varies wildly by date (0 on most days), and a
//     grid would reflow the whole controls panel every time.
//   - It sits BELOW the search + button row, so it never fights the
//     controls for horizontal space.
//   - `onOpenAll` keeps the old modal as the "see everything"
//     affordance — the card is a preview, not a replacement.

import { useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';
import { photoImageUrl } from '@/lib/photo-url';
import type { PhotoRow } from '@/components/PhotoViewer';

export type OnThisDayGroup = {
  year: number;
  photos: PhotoRow[];
};

export type MemoryMode = 'onThisDay' | 'recent';

type Props = {
  groups: OnThisDayGroup[];
  locale: Locale;
  /**
   * 'onThisDay'  — photos taken on today's month-day (strict
   *                "On This Day", TimeMap style).
   * 'recent'    — today's month-day has no photos, so we fall back
   *                to the most recent day that DOES have some.
   *
   * The fallback matters: 239 photos cover only 37 distinct
   * month-days, so a strict "On This Day" card would be empty on
   * ~85% of the calendar. The fallback keeps the daily-reflection
   * slot filled with something real instead of nothing.
   */
  mode: MemoryMode;
  /** Month (1-12) and day of the photos being shown. */
  month: number;
  day: number;
  /** Whole days between today and the shown date (0 = today). */
  daysAgo: number;
  onOpenAll: () => void;
  onPick: (photo: PhotoRow) => void;
};

export function OnThisDayCard({
  groups,
  locale,
  mode,
  month,
  day,
  daysAgo,
  onOpenAll,
  onPick,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  // The ‹ › arrows are only useful when the strip actually
  // overflows. With a single photo (which is the common case for
  // the "most recent record" fallback) there is nothing to scroll,
  // and the arrows are just two dead buttons.
  const [canScroll, setCanScroll] = useState(false);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () =>
      setCanScroll(el.scrollWidth - el.clientWidth > 4);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update);
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [groups.length]);

  if (groups.length === 0) return null;

  const total = groups.reduce((s, g) => s + g.photos.length, 0);

  // Newest year first, then chronological within the year. The
  // grouping is already year-keyed; sort explicitly so the order
  // doesn't depend on Map insertion order.
  const ordered = [...groups].sort((a, b) => b.year - a.year);
  const photos = ordered
    .flatMap((g) => g.photos.map((p) => ({ p, year: g.year })))
    .sort((a, b) =>
      a.year === b.year
        ? new Date(a.p.taken_at || a.p.created_at).getTime() -
          new Date(b.p.taken_at || b.p.created_at).getTime()
        : b.year - a.year,
    );

  const scrollBy = (dir: 1 | -1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section
      aria-label={t(locale, 'onThisDay.title')}
      className="mx-auto w-full max-w-4xl rounded-2xl border border-cyan-500/25 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-md dark:border-cyan-400/20 dark:bg-black/40"
    >
      {/* Two-line header: title + "see all" on the first line, the
          date / summary meta on the second. As a single wrapping row
          the meta items broke mid-phrase at the 330 px overlay
          width ("最近的记 / 录"). Each meta item is its own span, so
          it wraps as a whole rather than splitting. */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-black/85 dark:text-white/85">
            📅{' '}
            {mode === 'onThisDay'
              ? t(locale, 'onThisDay.title')
              : t(locale, 'onThisDay.recentTitle')}
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs tabular-nums text-black/60 dark:text-white/60">
            <span className="whitespace-nowrap">
              {t(locale, 'onThisDay.date', { month, day })}
            </span>
            {mode === 'recent' && (
              <span className="whitespace-nowrap text-black/55 dark:text-white/55">
                {daysAgo === 0
                  ? t(locale, 'onThisDay.today')
                  : t(locale, 'onThisDay.daysAgo', { days: daysAgo })}
              </span>
            )}
            <span className="whitespace-nowrap text-black/55 dark:text-white/55">
              {t(locale, 'onThisDay.summary', {
                years: ordered.length,
                count: total,
              })}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenAll}
          className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-cyan-500/40 px-3 text-[11px] text-cyan-700 transition hover:border-cyan-500 dark:border-cyan-400/30 dark:text-cyan-300/90"
        >
          {t(locale, 'onThisDay.all')} ›
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label={t(locale, 'onThisDay.scrollHint')}
          className="hidden shrink-0 rounded-full border border-black/15 px-2 text-xs leading-none text-black/60 transition hover:bg-black/5 dark:border-white/20 dark:text-white/60 sm:block"
          hidden={!canScroll}
        >
          ‹
        </button>

        <div
          ref={stripRef}
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth pb-1"
          style={{ scrollbarWidth: 'thin' }}
        >
          {photos.map(({ p, year }) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPick(p)}
              title={p.filename}
              aria-label={t(locale, 'onThisDay.photoAria', {
                year,
                month,
                day,
                name: p.filename,
              })}
              className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 transition hover:ring-2 hover:ring-cyan-500 dark:ring-white/10 dark:hover:ring-cyan-400"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoImageUrl(p, '256')}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
              {/* Year badge — the whole point of "on this day" is
                  which year you're looking at. */}
              <span className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 to-transparent px-1 pb-0.5 pt-2 text-[10px] font-medium leading-none text-white tabular-nums">
                {year}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label={t(locale, 'onThisDay.scrollHint')}
          className="hidden shrink-0 rounded-full border border-black/15 px-2 text-xs leading-none text-black/60 transition hover:bg-black/5 dark:border-white/20 dark:text-white/60 sm:block"
          hidden={!canScroll}
        >
          ›
        </button>
      </div>
    </section>
  );
}
