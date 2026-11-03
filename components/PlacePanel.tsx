'use client';

// Frank #7243 round-5: the Places-layer panel.
//
// Borrowed from OldMapsOnline / TimeMap, whose "Places" layer lets
// you click a city on the map and get a contextual panel — the
// entity's details plus what else is nearby — WITHOUT throwing
// away the map you were looking at. Their panel is deliberately
// not a full-screen takeover.
//
// LifeFrame had two dead-end interactions:
//   - clicking a single marker opened the full-screen PhotoViewer
//     → the globe context was gone in one tap
//   - clicking a cluster opened a `bg-black/80` full-screen modal
//     → even heavier, and it duplicated what the viewer already does
//
// This panel replaces both. It is a small floating card anchored to
// the Globe (bottom-right on desktop, bottom strip on mobile) that
// shows the place, the photo count, a scrollable thumbnail strip and
// a "view all" button. The Globe stays visible and interactive
// behind it; the full-screen viewer is still one tap away, but now
// it is a deliberate choice instead of the only option.
//
// The panel never steals the browser back button and never blocks
// the globe: it is a widget, not a modal.

import { useEffect, useMemo, useRef } from 'react';
import { t, type Locale } from '@/lib/i18n';
import { photoImageUrl } from '@/lib/photo-url';
import type { PhotoRow } from '@/components/PhotoViewer';

type Props = {
  photos: PhotoRow[];
  locale: Locale;
  /** Close the panel (✕, outside click, ESC). */
  onClose: () => void;
  /**
   * Open the full-screen viewer, scoped to THIS place's photos so
   * prev/next walks the location instead of the whole archive.
   */
  onOpenAll: (photos: PhotoRow[]) => void;
  /** Open the full-screen viewer at one specific photo. */
  onOpenPhoto: (photos: PhotoRow[], photo: PhotoRow) => void;
};

/**
 * Cap on how many thumbnails we render. One cluster on LifeFrame
 * holds 137 photos; rendering them all means 137 <img> elements
 * pointing at the auth-gated image proxy, and a scrollbar you can
 * drag across half a kilometre. 24 covers the visible strip; the
 * rest are reachable through "view all".
 */
const MAX_THUMBS = 24;

function formatDay(d: Date | null): string {
  if (!d) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function PlacePanel({ photos, locale, onClose, onOpenAll, onOpenPhoto }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the panel so keyboard users land on it (and so
  // ESC is reachable without hunting). The close button is the
  // first focusable element.
  useEffect(() => {
    const btn = panelRef.current?.querySelector<HTMLButtonElement>('button');
    btn?.focus();
  }, []);

  const { placeName, count, dateLabel, sorted } = useMemo(() => {
    const withDates = photos
      .map((p) => {
        const ts = p.taken_at || p.created_at;
        const d = ts ? new Date(ts) : null;
        return { p, d: d && !Number.isNaN(d.getTime()) ? d : null };
      })
      .sort((a, b) => (a.d?.getTime() ?? 0) - (b.d?.getTime() ?? 0));

    const named = photos.find((p) => p.location_name)?.location_name ?? null;
    const first = withDates[0]?.d ?? null;
    const last = withDates[withDates.length - 1]?.d ?? null;

    let label = '';
    if (first && last) {
      label =
        first.getTime() === last.getTime()
          ? formatDay(first)
          : `${formatDay(first)} – ${formatDay(last)}`;
    }

    return {
      placeName: named,
      count: photos.length,
      dateLabel: label,
      sorted: withDates.map((x) => x.p),
    };
  }, [photos]);

  if (photos.length === 0) return null;

  const title = placeName ?? t(locale, 'place.unknown');

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      // Not a modal: the Globe behind stays live, so this must not
      // trap focus or set aria-modal.
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto animate-[fadeIn_140ms_ease-out] rounded-2xl border border-black/10 bg-white/92 p-3 shadow-xl backdrop-blur-md dark:border-white/15 dark:bg-black/80"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium text-black/90 dark:text-white/90">
            📍 {title}
          </h2>
          <p className="mt-0.5 text-[11px] tabular-nums text-black/60 dark:text-white/60">
            {t(locale, 'place.count', { count })}
            {dateLabel ? ` · ${dateLabel}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          // Include the visible "✕" so the accessible name
          // contains the on-screen label (WCAG 2.5.3).
          aria-label={`✕ ${t(locale, 'place.close')}`}
          className="-mt-0.5 -mr-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm text-black/55 transition hover:bg-black/10 hover:text-black/80 dark:text-white/55 dark:hover:bg-white/15 dark:hover:text-white/85"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
        {sorted.slice(0, MAX_THUMBS).map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onOpenPhoto(sorted, p)}
            title={p.filename}
            aria-label={t(locale, 'place.photoAria', { name: p.filename })}
            className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 transition hover:ring-2 hover:ring-cyan-500 dark:ring-white/10 dark:hover:ring-cyan-400"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoImageUrl(p, '256')}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
          </button>
        ))}
        {sorted.length > MAX_THUMBS && (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-black/10 text-xs font-medium text-black/70 ring-1 ring-black/10 dark:bg-white/10 dark:text-white/75 dark:ring-white/10">
            +{sorted.length - MAX_THUMBS}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpenAll(sorted)}
        className="mt-2 inline-flex min-h-[32px] w-full items-center justify-center gap-1 rounded-full border border-cyan-500/40 px-3 text-[11px] text-cyan-700 transition hover:border-cyan-500 hover:bg-cyan-500/5 dark:border-cyan-400/30 dark:text-cyan-300/90"
      >
        {t(locale, 'place.viewAll', { count })} ›
      </button>
    </div>
  );
}
