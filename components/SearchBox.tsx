'use client';

import { useEffect, useId, useRef } from 'react';
import { t, type Locale } from '@/lib/i18n';
import type { PhotoRow } from '@/components/PhotoViewer';

/**
 * Frank #0906 round-13 (P1 #6): search input with live
 * match counter, clear button, and a thumbnail preview
 * dropdown showing the first N matches.
 *
 * Why a dedicated component: HomeGallery is 600+ lines; this
 * search affordance needs its own state (focus, recent
 * submissions, ESC handling, "/" hotkey) that doesn't fit
 * cleanly into the gallery's surface area. Also makes the
 * "search results preview" UI easy to unit-test.
 */
type Props = {
  locale: Locale;
  query: string;
  onQueryChange: (q: string) => void;
  matches: PhotoRow[];
  total: number;
  onPickMatch: (photo: PhotoRow) => void;
};

const PREVIEW_LIMIT = 6;

export function SearchBox({
  locale,
  query,
  onQueryChange,
  matches,
  total,
  onPickMatch,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropdownId = useId();

  // "/" hotkey focuses the search input — common pattern in
  // search-heavy UIs (GitHub, Linear, Notion all do this).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack when the user is already typing in some
      // other input/textarea/contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const trimmed = query.trim();
  const hasQuery = trimmed.length > 0;
  const showDropdown = hasQuery;

  return (
    <div className="relative w-full sm:w-80">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onQueryChange('');
              inputRef.current?.blur();
            }
          }}
          placeholder={t(locale, 'hero.searchPlaceholder')}
          aria-label={t(locale, 'hero.searchAriaLabel')}
          aria-controls={dropdownId}
          aria-expanded={showDropdown}
          className="min-h-[44px] w-full rounded-full border border-black/15 dark:border-white/15 bg-white/90 dark:bg-white/5 px-4 pr-20 text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 focus:border-black/40 dark:focus:border-white/40 focus:outline-none"
        />
        {/* Right-side cluster: live match counter + clear button.
            Counter is always visible; clear button only when the
            input has text. */}
        <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
          {hasQuery && (
            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] tabular-nums text-black/60 dark:bg-white/10 dark:text-white/70">
              {matches.length}
              <span className="mx-0.5 text-black/30 dark:text-white/30">/</span>
              {total}
            </span>
          )}
          {hasQuery && (
            <button
              type="button"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
              aria-label={t(locale, 'search.clear')}
              className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-black/50 transition hover:bg-black/10 hover:text-black dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            >
              ×
            </button>
          )}
        </div>
        {/* "/" hint when input is empty — fades on focus so it
            doesn't distract the user once they're typing. */}
        {!hasQuery && (
          <kbd className="pointer-events-none absolute inset-y-0 right-3 my-auto inline-flex h-6 items-center rounded border border-black/15 px-1.5 text-[10px] font-medium text-black/40 dark:border-white/15 dark:text-white/40">
            /
          </kbd>
        )}
      </div>

      {/* Result preview dropdown */}
      {showDropdown && (
        <div
          id={dropdownId}
          role="listbox"
          aria-label={t(locale, 'search.resultsLabel')}
          className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-auto rounded-xl border border-black/10 bg-white/95 p-2 shadow-xl backdrop-blur-md dark:border-white/15 dark:bg-black/90"
        >
          {matches.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-black/60 dark:text-white/60">
              <p className="mb-2">
                🔍{' '}
                {t(locale, 'search.noResults', { query: trimmed })}
              </p>
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="text-xs text-cyan-700 underline transition hover:text-cyan-500 dark:text-cyan-300 dark:hover:text-cyan-200"
              >
                {t(locale, 'search.clearAndBrowse')}
              </button>
            </div>
          ) : (
            <>
              <div className="px-2 pb-1 text-[11px] uppercase tracking-wider text-black/40 dark:text-white/40">
                {t(locale, 'search.resultsLabel')} ·{' '}
                {matches.length <= PREVIEW_LIMIT
                  ? matches.length
                  : `${PREVIEW_LIMIT}+`}
              </div>
              <ul className="space-y-1">
                {matches.slice(0, PREVIEW_LIMIT).map((m) => {
                  const takenAt = (m.taken_at ?? m.created_at ?? '').slice(
                    0,
                    10,
                  );
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => onPickMatch(m)}
                        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={
                            m.thumbnail_url ||
                            m.public_url ||
                            '/placeholder.png'
                          }
                          alt=""
                          loading="lazy"
                          width={48}
                          height={48}
                          className="h-12 w-12 flex-shrink-0 rounded object-cover ring-1 ring-black/5 dark:ring-white/10"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-black dark:text-white">
                            {m.filename || m.key}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-black/50 dark:text-white/50">
                            {takenAt && <span>📅 {takenAt}</span>}
                            {m.location_name && (
                              <span className="truncate">
                                📍 {m.location_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {matches.length > PREVIEW_LIMIT && (
                <div className="border-t border-black/5 px-2 pt-2 text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
                  {t(locale, 'search.moreHint', {
                    count: matches.length - PREVIEW_LIMIT,
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
