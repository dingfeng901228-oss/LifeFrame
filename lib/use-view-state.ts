'use client';

// Frank #7243 round-3: URL hash view-state hook.
//
// Borrowed from OldMapsOnline / TimeMap, which encodes the whole
// view in the URL:
//
//   #position=6/35.69/139.692&year=1850
//
// so any view is shareable and bookmarkable. LifeFrame keeps the
// selected date and the search query in `location.hash` for the
// same reason.
//
// Rules that keep this safe:
//   - The hash is only READ inside an effect, never during render,
//     so the server HTML and the first client render always match
//     (no hydration mismatch).
//   - Writes use history.replaceState, so scrubbing the timeline
//     doesn't fill the browser's back stack with hundreds of
//     entries.
//   - Writes are debounced, so typing in the search box doesn't
//     rewrite the URL on every keystroke.
//   - A malformed / hand-edited hash is ignored, never fatal.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildHash,
  EMPTY_VIEW_STATE,
  fromDateKey,
  parseHash,
  toDateKey,
  type ViewState,
} from '@/lib/view-state';

const WRITE_DEBOUNCE_MS = 400;

export function useUrlViewState() {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Guards the hashchange handler so applying a hash we just wrote
  // ourselves doesn't bounce back into state.
  const suppressHashEvent = useRef(false);
  const hydrated = useRef(false);

  // 1. Hydrate from the URL, once, after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const parsed = parseHash(window.location.hash);
    const date = fromDateKey(parsed.at);
    if (date) setSelectedDate(date);
    if (parsed.q) setSearchQuery(parsed.q);
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Write state back to the URL (debounced, replaceState).
  useEffect(() => {
    if (!hydrated.current) return;
    const handle = setTimeout(() => {
      const next: ViewState = {
        at: selectedDate ? toDateKey(selectedDate) : null,
        q: searchQuery.trim() || null,
      };
      const hash = buildHash(next);
      const current = window.location.hash.replace(/^#/, '');
      if (hash === current) return;
      suppressHashEvent.current = true;
      const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`;
      window.history.replaceState(null, '', url);
      // Clear the guard on the next tick — the hashchange event for
      // replaceState is async in some browsers.
      setTimeout(() => {
        suppressHashEvent.current = false;
      }, 0);
    }, WRITE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [selectedDate, searchQuery]);

  // 3. React to the user editing the hash by hand (or a real
  //    back/forward navigation).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHashChange = () => {
      if (suppressHashEvent.current) return;
      const parsed = parseHash(window.location.hash);
      const date = fromDateKey(parsed.at);
      setSelectedDate((cur) => {
        const curKey = cur ? toDateKey(cur) : null;
        return curKey === parsed.at ? cur : date;
      });
      setSearchQuery((cur) => (parsed.q ?? '') === cur ? cur : parsed.q ?? '');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /** Build the shareable URL for the current state. */
  const shareUrl = useCallback(() => {
    if (typeof window === 'undefined') return '';
    const next: ViewState = {
      at: selectedDate ? toDateKey(selectedDate) : null,
      q: searchQuery.trim() || null,
    };
    const hash = buildHash(next);
    return `${window.location.origin}${window.location.pathname}${hash ? `#${hash}` : ''}`;
  }, [selectedDate, searchQuery]);

  return {
    selectedDate,
    setSelectedDate,
    searchQuery,
    setSearchQuery,
    shareUrl,
  };
}

/**
 * Copy helper.
 *
 * Returns how it went so the UI can tell the truth:
 *   'copied'  — the text is on the clipboard
 *   'manual'  — the clipboard was unavailable; the URL was put in a
 *               prompt so the user can copy it by hand
 *   'failed'  — nothing worked
 *
 * The clipboard API needs a secure context AND a user gesture, and
 * some browsers (and headless environments) refuse it outright —
 * so never fail silently.
 */
export async function copyText(text: string): Promise<'copied' | 'manual' | 'failed'> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return 'copied';
  } catch {
    /* fall through to the prompt */
  }
  // Last resort: hand the URL to the user directly. Never leave the
  // user thinking a copy happened when it did not.
  try {
    window.prompt('复制此链接即可分享当前视图：', text);
    return 'manual';
  } catch {
    return 'failed';
  }
}

export { EMPTY_VIEW_STATE };
