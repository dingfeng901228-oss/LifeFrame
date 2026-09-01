'use client';

/**
 * Photo Detail Viewer — immersive, slide-animated photo browser.
 *
 * Replaces the original detail modal in HomeGallery with a
 * full-featured viewer that:
 *   - animates prev/next with horizontal slide + opacity fade (no full-page nav)
 *   - preloads prev/current/next (+ 2 further when network allows) so
 *     switching feels instant
 *   - syncs the URL to /p/<key> via history.pushState, so browser
 *     Back / Forward walks through photos instead of leaving the page
 *   - supports keyboard ←/→ (Esc closes), desktop left/right click
 *     zones, and pointer drag (mobile + desktop) with 80px commit
 *     threshold + snap-back below threshold
 *   - caches like / comment data per photo in Maps so rapid
 *     navigation doesn't refetch + flash
 *   - reserves the photo container's aspect ratio (3:2 default,
 *     upgraded to the photo's real ratio after first load) so
 *     images don't cause layout shift
 *   - shows a Retry overlay if the image fails to load
 *   - respects first/last photo boundaries (no loop by default)
 *
 * Browse context = the photos array passed in by the parent
 * (HomeGallery passes visiblePhotos, which already respects the
 * timeline filter + search query). Navigation uses the index of
 * the current photo in that array — no extra fetches.
 *
 * Per Frank #7509 spec — see MEMORY.md / commit log for the full
 * 22-section requirement. This file implements sections 一–二二
 * except §22 ("don't break existing features"), which is the
 * parent's responsibility.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { photoImageUrl } from '@/lib/photo-url';
import { t, type Locale } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────

export type PhotoRow = {
  key: string;
  public_url: string;
  thumbnail_url: string | null;
  filename: string;
  taken_at: string | null;
  created_at: string;
  camera_make: string | null;
  camera_model: string | null;
  categories: string[] | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
};

type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
};

type LikesCache = {
  count: number;
  userLiked: boolean;
  loaded: boolean;
};

type CommentsCache = {
  items: CommentRow[];
  loaded: boolean;
};

// -1 = entering from left, +1 = entering from right, 0 = idle / first mount
type EnterDirection = -1 | 0 | 1;

// ─── Constants ────────────────────────────────────────────────────

const SWIPE_COMMIT_THRESHOLD_PX = 80;
const ANIMATION_DURATION_MS = 280;
const PRELOAD_FURTHER_FALLBACK_TYPES = new Set(['2g', 'slow-2g']);

// CSS keyframes + classes for the photo slide animations. Injected
// via <style> tag once per viewer mount. Using cubic-bezier(0.32,
// 0.72, 0, 1) = Material "standard" easing — fast out, slow in,
// matches macOS Photos feel without a heavy animation library.
const VIEWER_STYLES = `
@keyframes pvSlideInFromRight {
  from { transform: translate3d(100%, 0, 0); opacity: 0; }
  to   { transform: translate3d(0, 0, 0); opacity: 1; }
}
@keyframes pvSlideInFromLeft {
  from { transform: translate3d(-100%, 0, 0); opacity: 0; }
  to   { transform: translate3d(0, 0, 0); opacity: 1; }
}
@keyframes pvSlideOutToLeft {
  from { transform: translate3d(0, 0, 0); opacity: 1; }
  to   { transform: translate3d(-100%, 0, 0); opacity: 0; }
}
@keyframes pvSlideOutToRight {
  from { transform: translate3d(0, 0, 0); opacity: 1; }
  to   { transform: translate3d(100%, 0, 0); opacity: 0; }
}
@keyframes pvMetadataFade {
  from { transform: translate3d(0, 6px, 0); opacity: 0; }
  to   { transform: translate3d(0, 0, 0); opacity: 1; }
}
.pv-photo-in-right { animation: pvSlideInFromRight ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1) both; }
.pv-photo-in-left  { animation: pvSlideInFromLeft  ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1) both; }
.pv-photo-out-left { animation: pvSlideOutToLeft   ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1) forwards; }
.pv-photo-out-right{ animation: pvSlideOutToRight  ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1) forwards; }
.pv-meta-fade      { animation: pvMetadataFade     ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1); }
`;

// Module-level cache for aspect ratios. Once a photo's full image
// has loaded once, we remember its width/height ratio for the rest
// of the session so subsequent opens of the same photo don't cause
// a layout shift. Bounded by total photo count — fine for a
// personal site.
const aspectRatioCache = new Map<string, number>();

// ─── Component ────────────────────────────────────────────────────

export type PhotoViewerProps = {
  /** All photos in browse order (parent passes its visiblePhotos). */
  photos: PhotoRow[];
  /** The photo to show first. Must be one of `photos`. */
  initialPhoto: PhotoRow;
  /** Translation locale. */
  locale: Locale;
  /** Whether the viewer user is signed in (controls like / comment UI). */
  isSignedIn: boolean;
  /** Current user id (used to label "你" in comments). */
  sessionUserId: string | null;
  /** Close the viewer (parent unmounts). The viewer restores the URL. */
  onClose: () => void;
};

export function PhotoViewer({
  photos,
  initialPhoto,
  locale,
  isSignedIn,
  sessionUserId,
  onClose,
}: PhotoViewerProps) {
  // ── Navigation state ────────────────────────────────────────────
  // currentPhoto = the photo on screen. direction = the direction of
  // the in-flight transition (or 0 if idle). leavingPhoto = the photo
  // sliding out (kept in DOM for ANIMATION_DURATION_MS so its CSS
  // animation has time to finish).
  const [currentPhoto, setCurrentPhoto] = useState<PhotoRow>(initialPhoto);
  const [direction, setDirection] = useState<EnterDirection>(0);
  const [leavingPhoto, setLeavingPhoto] = useState<{
    photo: PhotoRow;
    direction: Exclude<EnterDirection, 0>;
  } | null>(null);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Ref-based transition guard. Read synchronously inside the
  // navigate callback so a stale closure doesn't think we're
  // mid-transition after the timer has cleared `leavingPhoto`.
  // Without this, rapid key/click inputs after a transition
  // would be silently dropped because the captured navigate
  // closure still saw leavingPhoto !== null. (Frank #7509
  // self-test revealed this when ArrowRight after a previous
  // navigation didn't advance.)
  const transitioningRef = useRef(false);

  // ── Drag state (Pointer Events, unified desktop + mobile) ───────
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const pointerStartRef = useRef<{ x: number; id: number } | null>(null);

  // ── Per-photo data caches ───────────────────────────────────────
  const [likesByPhoto, setLikesByPhoto] = useState<Map<string, LikesCache>>(
    new Map(),
  );
  const [commentsByPhoto, setCommentsByPhoto] = useState<
    Map<string, CommentsCache>
  >(new Map());
  const [commentDraft, setCommentDraft] = useState('');
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [likePending, setLikePending] = useState(false);

  // ── Image-load state ────────────────────────────────────────────
  // imageErrorKey = the photo key that failed to load (overlay shows
  // for that key until retry succeeds or the photo changes).
  const [imageErrorKey, setImageErrorKey] = useState<string | null>(null);
  // retryNonce forces the <img> to remount and refetch.
  const [retryNonce, setRetryNonce] = useState(0);

  // ── URL history state ───────────────────────────────────────────
  // prevUrlRef = the URL before the viewer pushed its first entry.
  // Restored on close so Back from /welcome (after close) doesn't go
  // through every photo we viewed.
  const prevUrlRef = useRef<string>('');

  // ── Preload tracking ────────────────────────────────────────────
  const preloadedKeysRef = useRef<Set<string>>(new Set());

  // ── Computed: current index + boundaries ────────────────────────
  const currentIndex = useMemo(
    () => photos.findIndex((p) => p.key === currentPhoto.key),
    [photos, currentPhoto.key],
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < photos.length - 1;
  const prevPhoto = hasPrev ? photos[currentIndex - 1] : null;
  const nextPhoto = hasNext ? photos[currentIndex + 1] : null;

  // ── Aspect ratio for the current photo ──────────────────────────
  // Default to 3:2 (common landscape ratio) until we know better;
  // upgraded to the real ratio once the full image has loaded once.
  const aspectRatio =
    aspectRatioCache.get(currentPhoto.key) ?? 3 / 2;

  // ── Helpers ─────────────────────────────────────────────────────

  const navigateTo = useCallback(
    (target: PhotoRow, dir: Exclude<EnterDirection, 0>) => {
      if (target.key === currentPhoto.key) return;
      // Ref-based guard against rapid double-fires (key mash, very
      // fast clicks). We can't use leavingPhoto here because the
      // keyboard + pointer effect closures would capture a stale
      // value of leavingPhoto across renders.
      if (transitioningRef.current) return;
      transitioningRef.current = true;

      // Push new history entry. The state object carries our marker
      // (`lv: true`) so the popstate handler can tell viewer entries
      // apart from the page's own entries.
      if (typeof window !== 'undefined') {
        window.history.pushState(
          { lv: true, key: target.key },
          '',
          `/p/${encodeURIComponent(target.key)}`,
        );
      }

      setLeavingPhoto({ photo: currentPhoto, direction: dir });
      setCurrentPhoto(target);
      setDirection(dir);
      setImageErrorKey(null); // clear stale error for new photo

      // After the animation, clean up the leaving slot AND release
      // the transition guard so the next navigation can proceed.
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        setLeavingPhoto(null);
        setDirection(0);
        transitioningRef.current = false;
        transitionTimerRef.current = null;
      }, ANIMATION_DURATION_MS + 30);
    },
    [currentPhoto],
  );

  const goPrev = useCallback(() => {
    if (!prevPhoto) return;
    navigateTo(prevPhoto, -1);
  }, [navigateTo, prevPhoto]);

  const goNext = useCallback(() => {
    if (!nextPhoto) return;
    navigateTo(nextPhoto, 1);
  }, [navigateTo, nextPhoto]);

  // ── URL sync: push initial entry on mount, restore on close ─────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const prev = window.location.pathname + window.location.search;
    prevUrlRef.current = prev;
    window.history.pushState(
      { lv: true, key: initialPhoto.key },
      '',
      `/p/${encodeURIComponent(initialPhoto.key)}`,
    );

    return () => {
      // On unmount, restore the URL (handles the case where the
      // parent unmounts us for reasons other than explicit close —
      // e.g., route change). replaceState is a no-op if we're
      // already at prevUrl, so calling it twice (here + in
      // handleClose) is harmless.
      if (window.location.pathname !== prevUrlRef.current) {
        window.history.replaceState({}, '', prevUrlRef.current);
      }
    };
    // initialPhoto.key is the only relevant input — the mount
    // entry is fixed at "first photo shown". Re-running on prop
    // change would push duplicate entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── popstate: handle browser Back / Forward ─────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onPopState(e: PopStateEvent) {
      const state = e.state as { lv?: boolean; key?: string } | null;
      if (state?.lv && state.key) {
        // Back / Forward to another viewer entry — sync without
        // pushing a new history entry.
        const target = photos.find((p) => p.key === state.key);
        if (target && target.key !== currentPhoto.key && !transitioningRef.current) {
          transitioningRef.current = true;
          const targetIdx = photos.findIndex((p) => p.key === target.key);
          const currentIdx = photos.findIndex(
            (p) => p.key === currentPhoto.key,
          );
          const dir: Exclude<EnterDirection, 0> =
            targetIdx > currentIdx ? 1 : -1;
          setLeavingPhoto({ photo: currentPhoto, direction: dir });
          setCurrentPhoto(target);
          setDirection(dir);
          setImageErrorKey(null);
          if (transitionTimerRef.current)
            clearTimeout(transitionTimerRef.current);
          transitionTimerRef.current = setTimeout(() => {
            setLeavingPhoto(null);
            setDirection(0);
            transitioningRef.current = false;
            transitionTimerRef.current = null;
          }, ANIMATION_DURATION_MS + 30);
        }
      } else {
        // Back past the viewer — close.
        onClose();
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [photos, currentPhoto, leavingPhoto, onClose]);

  // ── Keyboard navigation ─────────────────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onKey(e: KeyboardEvent) {
      // Don't hijack arrow keys when the user is typing in the
      // comment textarea.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // goPrev/goNext are stable via useCallback + deps above; we
    // intentionally don't list them to avoid re-binding on every
    // photo change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhoto.key]);

  // ── Pointer drag (unified desktop + mobile) ────────────────────

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't start a drag if the pointer is on an interactive child
      // (button, link, textarea, input). The click event still
      // fires normally for those.
      const target = e.target as HTMLElement;
      if (target.closest('button, a, textarea, input, [role="button"]')) {
        return;
      }
      // Only primary pointer.
      if (!e.isPrimary) return;
      setIsDragging(true);
      setDragOffset(0);
      pointerStartRef.current = { x: e.clientX, id: e.pointerId };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already
        // released (e.g., very fast tap). Swallow.
      }
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !pointerStartRef.current) return;
      setDragOffset(e.clientX - pointerStartRef.current.x);
    },
    [isDragging],
  );

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !pointerStartRef.current) return;
      const finalOffset = dragOffset;
      setIsDragging(false);
      setDragOffset(0); // animate snap-back (transition class re-engages)
      pointerStartRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore.
      }
      if (Math.abs(finalOffset) > SWIPE_COMMIT_THRESHOLD_PX) {
        if (finalOffset > 0) goPrev();
        else goNext();
      }
      // Else: snap-back (handled by CSS transition on dragOffset).
    },
    [isDragging, dragOffset, goPrev, goNext],
  );

  // ── Close handler (restores URL via replaceState) ───────────────

  const handleClose = useCallback(() => {
    if (typeof window !== 'undefined' && prevUrlRef.current) {
      window.history.replaceState({}, '', prevUrlRef.current);
    }
    onClose();
  }, [onClose]);

  // ── Image preload (prev / current / next + 2 further) ──────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (currentIndex < 0) return;

    const conn =
      typeof (navigator as Navigator & { connection?: { effectiveType?: string } })
        .connection !== 'undefined'
        ? (navigator as Navigator & { connection?: { effectiveType?: string } })
            .connection
        : undefined;
    const isSlow = conn?.effectiveType
      ? PRELOAD_FURTHER_FALLBACK_TYPES.has(conn.effectiveType)
      : false;

    const slots: PhotoRow[] = [];
    if (hasPrev) slots.push(photos[currentIndex - 1]);
    if (hasNext) slots.push(photos[currentIndex + 1]);
    if (!isSlow) {
      if (currentIndex - 2 >= 0) slots.push(photos[currentIndex - 2]);
      if (currentIndex + 2 < photos.length) slots.push(photos[currentIndex + 2]);
    }

    for (const photo of slots) {
      if (preloadedKeysRef.current.has(photo.key)) continue;
      preloadedKeysRef.current.add(photo.key);
      const img = new window.Image();
      img.decoding = 'async';
      img.src = photoImageUrl(photo, 'full');
    }
  }, [currentIndex, hasPrev, hasNext, photos]);

  // ── Fetch likes for current photo (cache-first) ─────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = currentPhoto.key;
    if (likesByPhoto.get(key)?.loaded) return;

    let cancelled = false;
    fetch(`/api/photos/${encodeURIComponent(key)}/likes`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`likes ${r.status}`))))
      .then((data: { count?: number; userLiked?: boolean }) => {
        if (cancelled) return;
        setLikesByPhoto((prev) => {
          const next = new Map(prev);
          next.set(key, {
            count: data.count ?? 0,
            userLiked: Boolean(data.userLiked),
            loaded: true,
          });
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        // 401 (visibility-gated) or other failure — keep the slot
        // marked loaded with defaults so we don't refetch on every
        // navigation back.
        setLikesByPhoto((prev) => {
          const next = new Map(prev);
          next.set(key, { count: 0, userLiked: false, loaded: true });
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [currentPhoto.key, likesByPhoto]);

  // Background prefetch likes/comments for adjacent photos so a
  // rapid next/prev doesn't have to wait for a round-trip.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const adjacent: PhotoRow[] = [];
    if (prevPhoto) adjacent.push(prevPhoto);
    if (nextPhoto) adjacent.push(nextPhoto);
    for (const photo of adjacent) {
      const k = photo.key;
      if (!likesByPhoto.get(k)?.loaded) {
        fetch(`/api/photos/${encodeURIComponent(k)}/likes`)
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((data: { count?: number; userLiked?: boolean }) => {
            setLikesByPhoto((prev) => {
              const next = new Map(prev);
              next.set(k, {
                count: data.count ?? 0,
                userLiked: Boolean(data.userLiked),
                loaded: true,
              });
              return next;
            });
          })
          .catch(() => {
            setLikesByPhoto((prev) => {
              const next = new Map(prev);
              next.set(k, { count: 0, userLiked: false, loaded: true });
              return next;
            });
          });
      }
      if (!commentsByPhoto.get(k)?.loaded) {
        fetch(`/api/photos/${encodeURIComponent(k)}/comments`)
          .then((r) => (r.ok ? r.json() : Promise.reject()))
          .then((data: { comments?: CommentRow[] }) => {
            setCommentsByPhoto((prev) => {
              const next = new Map(prev);
              next.set(k, {
                items: data.comments ?? [],
                loaded: true,
              });
              return next;
            });
          })
          .catch(() => {
            setCommentsByPhoto((prev) => {
              const next = new Map(prev);
              next.set(k, { items: [], loaded: true });
              return next;
            });
          });
      }
    }
    // We intentionally don't include the cache Maps in deps — we
    // only want this to re-run when currentPhoto changes (which
    // changes which adjacent photos to prefetch), not on every
    // cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhoto.key, prevPhoto?.key, nextPhoto?.key]);

  // ── Fetch comments for current photo ────────────────────────────

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = currentPhoto.key;
    if (commentsByPhoto.get(key)?.loaded) return;

    let cancelled = false;
    setCommentsByPhoto((prev) => {
      // Mark as in-flight (loaded: false) so the UI shows a loading
      // state until the response lands.
      const next = new Map(prev);
      if (!next.has(key)) next.set(key, { items: [], loaded: false });
      return next;
    });
    fetch(`/api/photos/${encodeURIComponent(key)}/comments`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`comments ${r.status}`)),
      )
      .then((data: { comments?: CommentRow[] }) => {
        if (cancelled) return;
        setCommentsByPhoto((prev) => {
          const next = new Map(prev);
          next.set(key, {
            items: data.comments ?? [],
            loaded: true,
          });
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setCommentsByPhoto((prev) => {
          const next = new Map(prev);
          next.set(key, { items: [], loaded: true });
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [currentPhoto.key, commentsByPhoto]);

  // ── Like / comment handlers ─────────────────────────────────────

  const currentLikes = likesByPhoto.get(currentPhoto.key);
  const currentComments = commentsByPhoto.get(currentPhoto.key);

  async function toggleLike() {
    if (!isSignedIn || likePending || !currentPhoto) return;
    const key = currentPhoto.key;
    setLikePending(true);
    const before = likesByPhoto.get(key);
    const wasLiked = before?.userLiked ?? false;
    // Optimistic flip.
    setLikesByPhoto((prev) => {
      const next = new Map(prev);
      next.set(key, {
        count: (before?.count ?? 0) + (wasLiked ? -1 : 1),
        userLiked: !wasLiked,
        loaded: true,
      });
      return next;
    });
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(key)}/like`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`like ${res.status}`);
      const data = (await res.json()) as { liked?: boolean; count?: number };
      setLikesByPhoto((prev) => {
        const next = new Map(prev);
        next.set(key, {
          count: data.count ?? (before?.count ?? 0),
          userLiked: Boolean(data.liked),
          loaded: true,
        });
        return next;
      });
    } catch {
      // Revert.
      setLikesByPhoto((prev) => {
        const next = new Map(prev);
        next.set(key, {
          count: before?.count ?? 0,
          userLiked: wasLiked,
          loaded: true,
        });
        return next;
      });
    } finally {
      setLikePending(false);
    }
  }

  async function postComment() {
    const trimmed = commentDraft.trim();
    if (!isSignedIn || commentPending || trimmed.length === 0) return;
    setCommentPending(true);
    setCommentError(null);
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(currentPhoto.key)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 160));
      }
      const data = (await res.json()) as { comment?: CommentRow };
      if (data.comment) {
        setCommentsByPhoto((prev) => {
          const next = new Map(prev);
          const cur = prev.get(currentPhoto.key);
          next.set(currentPhoto.key, {
            items: [...(cur?.items ?? []), data.comment as CommentRow],
            loaded: true,
          });
          return next;
        });
      }
      setCommentDraft('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommentPending(false);
    }
  }

  async function deleteComment(id: string) {
    if (!isSignedIn || !currentPhoto) return;
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(currentPhoto.key)}/comments/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 160));
      }
      setCommentsByPhoto((prev) => {
        const next = new Map(prev);
        const cur = prev.get(currentPhoto.key);
        next.set(currentPhoto.key, {
          items: (cur?.items ?? []).filter((c) => c.id !== id),
          loaded: true,
        });
        return next;
      });
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  const likeCount = currentLikes?.count ?? 0;
  const userLiked = currentLikes?.userLiked ?? false;
  const comments = currentComments?.items ?? [];
  const commentsLoaded = currentComments?.loaded ?? false;
  const takenAt = currentPhoto.taken_at
    ? new Date(currentPhoto.taken_at).toLocaleString('zh-CN')
    : null;
  const showImageError = imageErrorKey === currentPhoto.key;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label={t(locale, 'viewer.label')}
    >
      <style>{VIEWER_STYLES}</style>

      <div
        className="relative flex max-h-[90vh] w-full max-w-4xl flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar: close + position indicator */}
        <div className="mb-2 flex items-center justify-between text-xs text-white/60">
          <span className="tabular-nums">
            {currentIndex >= 0
              ? `${currentIndex + 1} / ${photos.length}`
              : '—'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-white/80 backdrop-blur-md transition hover:border-white/40 hover:bg-white/20 hover:text-white"
          >
            ✕ {t(locale, 'viewer.close')}
          </button>
        </div>

        {/* Photo stage — fixed aspect ratio container, drag layer
            wraps the photo stack so pointer drag doesn't fight the
            CSS animation classes on the imgs. */}
        <div
          className="relative w-full select-none overflow-hidden rounded-lg bg-black/30 touch-none"
          style={{
            aspectRatio: String(aspectRatio),
            maxHeight: '75vh',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={(e) => {
            // Desktop click-zone: left third = prev, right third =
            // next. Middle third is a no-op (so a stray click
            // doesn't navigate).
            if (isDragging) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = x / rect.width;
            if (ratio < 0.33) goPrev();
            else if (ratio > 0.67) goNext();
          }}
        >
          {/* Drag layer (follows finger during pointer drag) */}
          <div
            className="absolute inset-0"
            style={{
              transform: `translate3d(${dragOffset}px, 0, 0)`,
              transition: isDragging
                ? 'none'
                : `transform ${ANIMATION_DURATION_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
              willChange: 'transform',
            }}
          >
            {/* Leaving photo (slides out via CSS animation) */}
            {leavingPhoto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`leaving-${leavingPhoto.photo.key}`}
                src={photoImageUrl(leavingPhoto.photo, 'full')}
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`absolute inset-0 h-full w-full object-contain ${
                  leavingPhoto.direction === 1
                    ? 'pv-photo-out-left'
                    : 'pv-photo-out-right'
                }`}
              />
            )}
            {/* Current photo */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`current-${currentPhoto.key}-${retryNonce}`}
              src={photoImageUrl(currentPhoto, 'full')}
              alt={currentPhoto.filename}
              draggable={false}
              className={`absolute inset-0 h-full w-full object-contain ${
                direction === 1
                  ? 'pv-photo-in-right'
                  : direction === -1
                    ? 'pv-photo-in-left'
                    : ''
              }`}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                  const ratio = el.naturalWidth / el.naturalHeight;
                  if (
                    !aspectRatioCache.has(currentPhoto.key) ||
                    aspectRatioCache.get(currentPhoto.key) !== ratio
                  ) {
                    aspectRatioCache.set(currentPhoto.key, ratio);
                    // Force one re-render so the container picks up
                    // the new aspect-ratio on the next paint.
                    setCurrentPhoto((prev) => ({ ...prev }));
                  }
                }
                setImageErrorKey(null);
              }}
              onError={() => setImageErrorKey(currentPhoto.key)}
            />
          </div>

          {/* Image-load error overlay */}
          {showImageError && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70">
              <div className="text-center text-white">
                <p className="mb-3 text-sm">
                  {t(locale, 'viewer.unableToLoad')}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setImageErrorKey(null);
                    setRetryNonce((n) => n + 1);
                  }}
                  className="rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-sm text-white backdrop-blur-md transition hover:bg-white/20"
                >
                  ↻ {t(locale, 'viewer.retry')}
                </button>
              </div>
            </div>
          )}

          {/* Prev button — desktop hover, frosted-glass. Hidden on
              first photo. Always visible on mobile (touch users
              still want it). */}
          <button
            type="button"
            onClick={goPrev}
            disabled={!hasPrev}
            aria-label={t(locale, 'viewer.prev')}
            className={`absolute left-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border text-2xl shadow-lg backdrop-blur-md transition ${
              hasPrev
                ? 'border-white/30 bg-white/20 text-white hover:bg-white/30'
                : 'cursor-not-allowed border-white/10 bg-white/5 text-white/30'
            }`}
          >
            ‹
          </button>
          {/* Next button */}
          <button
            type="button"
            onClick={goNext}
            disabled={!hasNext}
            aria-label={t(locale, 'viewer.next')}
            className={`absolute right-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border text-2xl shadow-lg backdrop-blur-md transition ${
              hasNext
                ? 'border-white/30 bg-white/20 text-white hover:bg-white/30'
                : 'cursor-not-allowed border-white/10 bg-white/5 text-white/30'
            }`}
          >
            ›
          </button>
        </div>

        {/* Metadata + like + comment — wrapped with key=
            currentPhoto.key so the whole block fades in on each
            photo change (subtle, not the whole page). */}
        <div
          key={`meta-${currentPhoto.key}`}
          className="pv-meta-fade mt-4 space-y-1 text-sm text-white/70"
        >
          <p className="truncate text-white">{currentPhoto.filename}</p>
          {takenAt && <p>📅 {takenAt}</p>}
          {currentPhoto.location_name ? (
            <p>📍 {currentPhoto.location_name}</p>
          ) : currentPhoto.lat != null && currentPhoto.lng != null ? (
            <p>
              📍 {currentPhoto.lat.toFixed(2)}, {currentPhoto.lng.toFixed(2)}
            </p>
          ) : null}
          {(currentPhoto.camera_make || currentPhoto.camera_model) && (
            <p>
              📷{' '}
              {[currentPhoto.camera_make, currentPhoto.camera_model]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
          {currentPhoto.categories && currentPhoto.categories.length > 0 && (
            <p>🏷️ {currentPhoto.categories.join(' · ')}</p>
          )}

          {/* Like row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleLike}
              disabled={!isSignedIn || likePending}
              aria-pressed={userLiked}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                userLiked
                  ? 'border-rose-400/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                  : 'border-white/20 bg-white/5 text-white/70 hover:border-white/40 hover:text-white'
              }`}
              title={
                isSignedIn
                  ? userLiked
                    ? t(locale, 'viewer.unlike')
                    : t(locale, 'viewer.like')
                  : t(locale, 'viewer.likeSignInHint')
              }
            >
              <span aria-hidden="true">{userLiked ? '❤️' : '🤍'}</span>
              <span className="tabular-nums">{likeCount}</span>
            </button>
            {!isSignedIn && (
              <span className="text-xs text-white/40">
                {t(locale, 'viewer.likeSignInHint')}
              </span>
            )}
          </div>

          <p className="break-all">
            🔗{' '}
            <a
              href={`/p/${encodeURIComponent(currentPhoto.key)}`}
              className="text-sky-300 underline"
              onClick={(e) => {
                // The viewer already updates history to /p/<key>;
                // clicking the link shouldn't reload the page.
                e.preventDefault();
              }}
            >
              {`/p/${currentPhoto.key}`}
            </a>
          </p>
        </div>

        {/* Comments section */}
        <div
          key={`comments-${currentPhoto.key}`}
          className="pv-meta-fade mt-6 border-t border-white/10 pt-4"
        >
          <h4 className="mb-3 text-sm font-medium text-white/80">
            💬 {t(locale, 'viewer.comments')}{' '}
            <span className="text-white/40">({comments.length})</span>
          </h4>

          <div className="mb-4 max-h-48 space-y-2 overflow-y-auto">
            {!commentsLoaded ? (
              <p className="text-xs text-white/40">{t(locale, 'viewer.loading')}</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-white/40">{t(locale, 'viewer.noComments')}</p>
            ) : (
              comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded border border-white/10 bg-white/[0.02] p-2"
                >
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-white/40">
                      {c.user_id === sessionUserId
                        ? t(locale, 'viewer.you')
                        : `user_${c.user_id.slice(0, 4)}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-white/30 tabular-nums">
                        {new Date(c.created_at).toLocaleString('zh-CN')}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteComment(c.id)}
                        className="text-rose-300/60 transition hover:text-rose-300"
                        title={t(locale, 'viewer.delete')}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <p
                    className="whitespace-pre-wrap break-words text-sm text-white/80"
                    dangerouslySetInnerHTML={{ __html: c.content }}
                  />
                </div>
              ))
            )}
          </div>

          {commentError && (
            <p className="mb-2 rounded border border-rose-500/30 bg-rose-900/20 p-2 text-xs text-rose-300">
              {commentError}
            </p>
          )}

          {isSignedIn ? (
            <div className="flex items-end gap-2">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder={t(locale, 'viewer.commentPlaceholder')}
                className="flex-1 resize-none rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
              />
              <button
                type="button"
                onClick={postComment}
                disabled={commentPending || commentDraft.trim().length === 0}
                className="rounded bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {commentPending ? t(locale, 'viewer.posting') : t(locale, 'viewer.post')}
              </button>
            </div>
          ) : (
            <p className="text-xs text-white/40">
              {t(locale, 'viewer.commentSignInHint')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
