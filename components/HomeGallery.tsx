'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe } from '@/components/Globe';
import { Timeline } from '@/components/Timeline';
import { TimeTravel } from '@/components/TimeTravel';
import { LifeJourney } from '@/components/LifeJourney';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type PhotoRow = {
  key: string;
  lat: number | null;
  lng: number | null;
  public_url: string;
  thumbnail_url: string | null;
  filename: string;
  taken_at: string | null;
  created_at: string;
  camera_make: string | null;
  camera_model: string | null;
  categories: string[] | null;
  // Per §24 of 要件定義書: "实际位置在公开页面只显示 Tokyo, Japan，
  // 甚至可以提供模糊位置（只显示城市，不显示具体地点）".
  // Prefer this over lat/lng in the UI; fall back to rounded lat/lng
  // when the photo was uploaded without going through Nominatim.
  location_name: string | null;
};

// §4 of 需求0827 — comment row shape (subset of photo_comments table).
type CommentRow = {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
};

// Frank #7203 #3: ±30 天 → ±15 天. The constant is the total
// window size; Timeline.tsx halves it for the cyan range overlay
// (±windowDays/2) and for the matching filter inside the gallery.
// 60 days = ±30 (old), 30 days = ±15 (new).
const TIMELINE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 3600 * 1000;

export function HomeGallery() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PhotoRow | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // Frank #7187: batch-level cluster context for the photo detail
  // modal. When the detail modal is opened from a 'same-location
  // photos' (同地点照片) cluster thumbnail, this holds the rest
  // of the cluster's photos so prev/next navigation knows what set
  // to iterate. null = opened from a single marker (not a cluster)
  // → no prev/next UI shown.
  const [selectedCluster, setSelectedCluster] = useState<PhotoRow[] | null>(null);
  // Frank #7187: live swipe offset (px) applied as translateX to the
  // image container while the user is dragging. Released above the
  // threshold (>80 px) → goPrev/goNext + snap back; below the
  // threshold → snap back only. The transform transition uses iOS-
  // like cubic-bezier for the snap-back so it feels native on both
  // desktop click and mobile swipe.
  const [animOffset, setAnimOffset] = useState(0);
  // Frank #7187: touch start position (clientX). Used as the
  // reference for deltaX during swipe drag.
  const touchStartXRef = useRef<number | null>(null as number | null);
  const [onThisDayOpen, setOnThisDayOpen] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(false);
  const [clusterPhotos, setClusterPhotos] = useState<PhotoRow[]>([]);
  const [timeTravelOpen, setTimeTravelOpen] = useState(false);
  const [lifeJourneyOpen, setLifeJourneyOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // §3 of 需求0827 — like state for the currently-selected photo.
  const [likeCount, setLikeCount] = useState(0);
  const [userLiked, setUserLiked] = useState(false);
  const [likePending, setLikePending] = useState(false);
  // null = not loaded yet / guest; set after auth.getSession() resolves.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  // §4 of 需求0827 — comments for the currently-selected photo.
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [commentPending, setCommentPending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  useEffect(() => {
    // Frank #7203 #4: use the cached browser client (cookie-backed
    // via @supabase/ssr) instead of constructing a fresh
    // @supabase/supabase-js client. The login page signs the user
    // in via getSupabaseBrowserClient(), which writes the session
    // into Supabase's auth-token cookies. A plain `createClient`
    // here would use localStorage instead — and because the login
    // flow never writes to localStorage, that client would always
    // see getSession() = null → sessionUserId stays null → like /
    // comment buttons stay disabled even for signed-in users.
    //
    // Same client everywhere means cookies are the single source
    // of truth, and onAuthStateChange below fires for the same
    // auth events the login flow emits.
    let supabase: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      supabase = getSupabaseBrowserClient();
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : String(err),
      );
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select(
            'key, lat, lng, public_url, thumbnail_url, filename, taken_at, created_at, camera_make, camera_model, categories, location_name',
          )
          .order('created_at', { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (error) {
          console.error('[gallery fetch error]', error.message);
          setFetchError(error.message);
        } else if (data) {
          setPhotos(data as PhotoRow[]);
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[gallery fetch threw]', msg);
        setFetchError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ESC cascades through modals — top-most closes first.
  // Detail modal wins over On This Day, which wins over Cluster.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (onThisDayOpen) setOnThisDayOpen(false);
      else if (clusterOpen) setClusterOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, onThisDayOpen, clusterOpen]);

  // Resolve the current session so the photo detail's ❤ button can
  // // decide between "show clickable ❤" (signed in) and "show '登录
  // 后点赞' hint" (guest). §3.4 + §8.1 of 需求0827.
  useEffect(() => {
    let mounted = true;
    // Frank #7203 #4: getSupabaseBrowserClient() (cookie-backed
    // @supabase/ssr) instead of a fresh createClient() (localStorage
    // @supabase/supabase-js). The login page uses the same cached
    // client, so the session JWT written into cookies at sign-in is
    // visible here on the very next render. The previous
    // createClient() always read null because localStorage was
    // empty (login never wrote to it).
    let supabase: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      // No env / env misconfigured — treat as guest, sessionUserId
      // stays null. No need to surface a separate error here; the
      // photos fetch effect already reports env issues.
      return;
    }
    // Frank #7117 #4: getUser() → getSession(). Reads the JWT from
    // cookies locally — no network round-trip, no race where
    // getUser() briefly returns null right after sign-in.
    //
    // Frank #7129 Task #2: also subscribe to onAuthStateChange so
    // the sessionUserId state updates LIVE when the user signs in /
    // out without unmounting HomeGallery. The one-shot getSession()
    // above only fires on mount; the subscription fires
    // synchronously with the current state when subscribed AND on
    // every subsequent auth-state change.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (mounted)
          setSessionUserId(data.session?.user?.id ?? null);
      })
      .catch(() => {
        // Silent — stay null, treat as guest.
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mounted) setSessionUserId(session?.user?.id ?? null);
      },
    );

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Fetch likes for the photo currently open in the detail modal.
  // Resets to 0/false when the modal closes so a stale count doesn't
  // leak into the next photo's open.
  useEffect(() => {
    if (!selected) {
      setLikeCount(0);
      setUserLiked(false);
      return;
    }
    let mounted = true;
    fetch(`/api/photos/${encodeURIComponent(selected.key)}/likes`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { count?: number; userLiked?: boolean }) => {
        if (!mounted) return;
        setLikeCount(data.count ?? 0);
        setUserLiked(Boolean(data.userLiked));
      })
      .catch(() => {
        // Silent — count stays at 0, button stays disabled for guests.
      });
    return () => {
      mounted = false;
    };
  }, [selected?.key]);

  // Fetch comments for the selected photo (§4). Resets to empty when
  // modal closes so the next photo's open starts fresh.
  useEffect(() => {
    if (!selected) {
      setComments([]);
      return;
    }
    let mounted = true;
    setCommentsLoading(true);
    fetch(`/api/photos/${encodeURIComponent(selected.key)}/comments`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { comments?: CommentRow[] }) => {
        if (!mounted) return;
        setComments(data.comments ?? []);
      })
      .catch(() => {
        // Silent — empty list is the fallback.
      })
      .finally(() => {
        if (mounted) setCommentsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selected?.key]);

  async function postComment() {
    const trimmed = newCommentText.trim();
    if (
      !sessionUserId ||
      commentPending ||
      !selected ||
      trimmed.length === 0
    )
      return;
    setCommentPending(true);
    setCommentError(null);
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(selected.key)}/comments`,
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
        setComments((c) => [...c, data.comment as CommentRow]);
      }
      setNewCommentText('');
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommentPending(false);
    }
  }

  async function deleteComment(id: string) {
    if (!sessionUserId || !selected) return;
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(selected.key)}/comments/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 160));
      }
      setComments((c) => c.filter((x) => x.id !== id));
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleLike() {
    if (!sessionUserId || likePending || !selected) return;
    const key = selected.key;
    setLikePending(true);
    // Optimistic flip; server response reconciles the authoritative
    // count so two rapid clicks still end up at the right total.
    const wasLiked = userLiked;
    setUserLiked(!wasLiked);
    setLikeCount((c) => c + (wasLiked ? -1 : 1));
    try {
      const res = await fetch(
        `/api/photos/${encodeURIComponent(key)}/like`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`like toggle ${res.status}`);
      const data = (await res.json()) as {
        liked?: boolean;
        count?: number;
      };
      if (typeof data.liked === 'boolean') setUserLiked(data.liked);
      if (typeof data.count === 'number') setLikeCount(data.count);
    } catch {
      // Revert optimistic update on failure.
      setUserLiked(wasLiked);
      setLikeCount((c) => c + (wasLiked ? 1 : -1));
    } finally {
      setLikePending(false);
    }
  }

  // §27 second-phase: photo search. Filter photos by query matching
  // filename / location_name / any category. Empty query = no filter.
  // Scopes the Globe + Timeline + count text. On This Day and Time
  // Travel still use the full photos list — those are global
  // features by design (you want your whole life in Time Travel,
  // not just the search subset).
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filteredPhotos = useMemo(() => {
    if (!trimmedQuery) return photos;
    return photos.filter((p) => {
      if (p.filename?.toLowerCase().includes(trimmedQuery)) return true;
      if (p.location_name?.toLowerCase().includes(trimmedQuery)) return true;
      if (p.categories?.some((c) => c.toLowerCase().includes(trimmedQuery)))
        return true;
      return false;
    });
  }, [photos, trimmedQuery]);

  // Photos with GPS coords that also fall inside the selected date window
  // (if any). Empty selection = all photos. This is what drives the
  // globe markers — index-aligned with `markers` for the click handler.
  const visiblePhotos = useMemo(() => {
    let arr = filteredPhotos.filter(
      (p): p is PhotoRow & { lat: number; lng: number } =>
        p.lat != null && p.lng != null,
    );
    if (selectedDate) {
      const half = (TIMELINE_WINDOW_DAYS / 2) * MS_PER_DAY;
      const lo = selectedDate.getTime() - half;
      const hi = selectedDate.getTime() + half;
      arr = arr.filter((p) => {
        const ts = p.taken_at || p.created_at;
        if (!ts) return false;
        const t = new Date(ts).getTime();
        return t >= lo && t <= hi;
      });
    }
    return arr;
  }, [filteredPhotos, selectedDate]);

  const markers = useMemo(
    () =>
      visiblePhotos.map((p) => ({
        location: [p.lat, p.lng] as [number, number],
      })),
    [visiblePhotos],
  );

  // Stable Globe handlers — useCallback so the React.memo wrap
  // around Globe can short-circuit re-renders when markers + handlers
  // are unchanged across selectedDate ticks during Time Travel.
  const handleMarkerSelect = useCallback(
    (idx: number) => {
      const photo = visiblePhotos[idx];
      if (photo) setSelected(photo);
    },
    [visiblePhotos],
  );

  const handleClusterClick = useCallback(
    (indices: number[]) => {
      const photos = indices
        .map((i) => visiblePhotos[i])
        .filter(
          (p): p is PhotoRow & { lat: number; lng: number } => Boolean(p),
        );
      if (photos.length > 0) {
        setClusterPhotos(photos);
        setClusterOpen(true);
      }
    },
    [visiblePhotos],
  );

  const visibleCount = visiblePhotos.length;

  // ── On This Day (§19 of 要件定義書) ─────────────────────────────
  // Photos taken on today's month-day in any year. Grouped by year
  // for the modal. Returns [] when no photos match — the trigger
  // button stays hidden in that case.
  const onThisDayGrouped = useMemo(() => {
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const day = now.getDate(); // 1-31

    const matching = photos.filter((p) => {
      const ts = p.taken_at || p.created_at;
      if (!ts) return false;
      const d = new Date(ts);
      if (isNaN(d.getTime())) return false;
      return d.getMonth() === month && d.getDate() === day;
    });

    const byYear = new Map<number, PhotoRow[]>();
    for (const p of matching) {
      const ts = p.taken_at || p.created_at;
      const d = new Date(ts!);
      const year = d.getFullYear();
      const arr = byYear.get(year);
      if (arr) arr.push(p);
      else byYear.set(year, [p]);
    }

    return [...byYear.entries()]
      .sort(([a], [b]) => b - a) // newest year first
      .map(([year, yearPhotos]) => ({ year, photos: yearPhotos }));
  }, [photos]);

  // Frank #7187: photo detail modal navigation. When the detail
  // modal is opened from a cluster thumbnail, prev/next navigate
  // through the rest of the cluster's photos. When opened from a
  // single marker (handleMarkerSelect), selectedCluster is null
  // and the prev/next buttons are hidden. The selectedClusterIndex
  // derived value -1 means "no cluster context" — the UI treats
  // that as "don't render prev/next".
  const selectedClusterIndex = useMemo(() => {
    if (!selected || !selectedCluster) return -1;
    return selectedCluster.findIndex((p) => p.key === selected.key);
  }, [selected, selectedCluster]);

  function goPrev() {
    if (!selectedCluster) return;
    const idx = selectedClusterIndex;
    if (idx <= 0) return;
    setSelected(selectedCluster[idx - 1]);
  }

  function goNext() {
    if (!selectedCluster) return;
    const idx = selectedClusterIndex;
    if (idx >= selectedCluster.length - 1) return;
    setSelected(selectedCluster[idx + 1]);
  }

  // Frank #7187: mobile swipe handlers on the photo container.
  // onTouchStart records the start X; onTouchMove updates the live
  // translateX so the photo follows the finger; onTouchEnd decides
  // whether to commit (>= 80 px past start) or snap back. The
  // container's CSS transition handles the snap-back easing.
  // <HTMLDivElement> generic required: handlers are bound to a
  // <div> (the swipe container) so TypeScript needs the generic
  // to match the inferred TouchEventHandler<HTMLDivElement> type.
  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touchStartXRef.current = e.touches[0].clientX;
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartXRef.current === null) return;
    setAnimOffset(e.touches[0].clientX - touchStartXRef.current);
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartXRef.current === null) return;
    const threshold = 80;
    if (animOffset > threshold) {
      goPrev();
    } else if (animOffset < -threshold) {
      goNext();
    }
    setAnimOffset(0);
    touchStartXRef.current = null;
  }

  return (
    <>
      <div className="absolute inset-0">
        <Globe
          markers={markers}
          onMarkerSelect={handleMarkerSelect}
          onClusterClick={handleClusterClick}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center px-6 text-center">
        <p className="text-xs tracking-[0.4em] text-black/50 dark:text-white/50 uppercase">
          写真で、暮らしの軌跡を残す
        </p>
        <h1 className="mt-3 text-2xl font-light text-black dark:text-white md:text-3xl">
          用照片，留下生活的痕迹。
        </h1>
        <p className="mt-2 max-w-sm text-sm text-black/50 dark:text-white/50">
          {loading
            ? '加载中…'
            : photos.length === 0
              ? '首页 3D 地球仪 — 上传第一张照片点亮地点'
              : trimmedQuery
                ? `${visibleCount} 张匹配 "${searchQuery.trim()}" · 共 ${photos.length} 张`
                : selectedDate
                  ? `${visibleCount} 张照片在 ${formatMonth(selectedDate)} ± ${TIMELINE_WINDOW_DAYS / 2} 天窗口内`
                  : `${photos.length} 张照片已点亮地点`}
        </p>
        {photos.length > 0 && (
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 搜索照片 (文件名 / 地点 / 分类)..."
            className="pointer-events-auto mt-3 w-full max-w-sm rounded-full border border-black/15 dark:border-white/15 bg-black/5 dark:bg-white/5 px-4 py-2 text-sm text-black dark:text-white placeholder-black/40 dark:placeholder-white/40 focus:border-black/40 dark:focus:border-white/40 focus:outline-none"
          />
        )}
        <div className="pointer-events-auto mt-3 flex flex-wrap items-center justify-center gap-2">
          {onThisDayGrouped.length > 0 && (
            <button
              type="button"
              onClick={() => setOnThisDayOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 dark:border-cyan-400/30 bg-white/95 dark:bg-black/40 px-3 py-1.5 text-xs text-cyan-700 dark:text-cyan-300/90 backdrop-blur-sm transition hover:border-cyan-500 dark:hover:border-cyan-400/60 hover:text-cyan-700 dark:hover:text-cyan-300"
            >
              📅 历史上这一天 · {onThisDayGrouped.length} 个年份 ·{' '}
              {onThisDayGrouped.reduce((s, g) => s + g.photos.length, 0)} 张照片
            </button>
          )}
          {photos.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setTimeTravelOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/40 dark:border-fuchsia-400/30 bg-white/95 dark:bg-black/40 px-3 py-1.5 text-xs text-fuchsia-700 dark:text-fuchsia-300/90 backdrop-blur-sm transition hover:border-fuchsia-500 dark:hover:border-fuchsia-400/60 hover:text-fuchsia-700 dark:hover:text-fuchsia-300"
              >
                ▶ 时间旅行 · Explore My Life
              </button>
              {photos.some((p) => p.location_name) && (
                <button
                  type="button"
                  onClick={() => setLifeJourneyOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 dark:border-emerald-400/30 bg-white/95 dark:bg-black/40 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300/90 backdrop-blur-sm transition hover:border-emerald-500 dark:hover:border-emerald-400/60 hover:text-emerald-700 dark:hover:text-emerald-300"
                >
                  🌏 人生足迹 · Life Journey
                </button>
              )}
            </>
          )}
        </div>
        {fetchError && (
          <p className="mt-3 max-w-md text-xs text-rose-700 dark:text-rose-300/90">
            � 加载照片失败：{fetchError}
            <br />
            <span className="text-black/40 dark:text-white/40">
              检查 Supabase URL/anon key 是否在 Vercel Environment Variables 配齐。
            </span>
          </p>
        )}
      </div>

      {/* Timeline — drives the globe marker filter. Pinned to the
          very bottom (bottom-3) so it sits below the (now smaller)
          globe on desktop without overlapping. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-3">
        <Timeline
          photos={photos}
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          windowDays={TIMELINE_WINDOW_DAYS}
        />
      </div>

      

      {/* Detail modal — full image + EXIF */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-4xl overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute -top-10 right-0 text-sm text-white/60 hover:text-white"
            >
              ✕ 关闭 (ESC)
            </button>
            {/* Frank #7187: swipe container — wraps the image so touch
                gestures on the image track deltaX and translate it
                via translateX. CSS transition uses iOS-like easing
                (cubic-bezier(0.25, 0.46, 0.45, 0.94)) for the snap-
                back / commit animation. The prev/next buttons are
                positioned absolute relative to this wrapper. */}
            <div
              className="relative touch-pan-y"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              style={{
                transform: `translateX(${animOffset}px)`,
                transition:
                  animOffset === 0
                    ? 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
                    : 'none',
              }}
            >
              {/* Frank #7187: frosted-glass prev button (left side).
                  Rendered only when a cluster context exists AND
                  we're not at the first photo in the cluster. */}
              {selectedCluster &&
                selectedClusterIndex > 0 && (
                  <button
                    type="button"
                    onClick={goPrev}
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/20 text-2xl text-white shadow-lg backdrop-blur-md transition hover:bg-white/30"
                    title="上一张"
                  >
                    ‹
                  </button>
                )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.public_url}
              alt={selected.filename}
              className="max-h-[75vh] w-full rounded object-contain"
            />
              {/* Frank #7187: frosted-glass next button (right side).
                  Rendered only when a cluster context exists AND
                  we're not at the last photo in the cluster. */}
              {selectedCluster &&
                selectedClusterIndex < selectedCluster.length - 1 && (
                  <button
                    type="button"
                    onClick={goNext}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/20 text-2xl text-white shadow-lg backdrop-blur-md transition hover:bg-white/30"
                    title="下一张"
                  >
                    ›
                  </button>
                )}
            </div>
            <div className="mt-4 space-y-1 text-sm text-white/70">
              <p className="text-white">{selected.filename}</p>
              {selected.taken_at && (
                <p>
                  📅 {new Date(selected.taken_at).toLocaleString('zh-CN')}
                </p>
              )}
              {selected.location_name ? (
                <p>
                  📍 {selected.location_name}
                </p>
              ) : selected.lat != null && selected.lng != null ? (
                <p>
                  � {selected.lat.toFixed(2)}, {selected.lng.toFixed(2)}
                </p>
              ) : null}
              {(selected.camera_make || selected.camera_model) && (
                <p>
                  📷{' '}
                  {[selected.camera_make, selected.camera_model]
                    .filter(Boolean)
                    .join(' ')}
                </p>
              )}
              {selected.categories && selected.categories.length > 0 && (
                <p>🏷️ {selected.categories.join(' · ')}</p>
              )}

              {/* §3 of 需求0827 — like button + count. Disabled
                  until signed in; click toggles via POST
                  /api/photos/[key]/like with optimistic update +
                  server reconcile. */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={toggleLike}
                  disabled={!sessionUserId || likePending}
                  aria-pressed={userLiked}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    userLiked
                      ? 'border-rose-400/60 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                      : 'border-white/20 bg-white/5 text-white/70 hover:border-white/40 hover:text-white'
                  }`}
                  title={
                    sessionUserId
                      ? userLiked
                        ? '取消点赞'
                        : '点赞'
                      : '登录后点赞'
                  }
                >
                  <span aria-hidden="true">{userLiked ? '❤️' : '🤍'}</span>
                  <span className="tabular-nums">{likeCount}</span>
                </button>
                {!sessionUserId && (
                  <span className="text-xs text-white/40">登录后点赞</span>
                )}
              </div>

              <p className="break-all">
                🔗{' '}
                <a
                  href={selected.public_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 underline"
                >
                  {selected.public_url}
                </a>
              </p>
              {/* Frank #7129 #3: removed the stale "(分类编辑 + 删除
                  功能下次迭代)" disclaimer — per-photo edit modal
                  now exists (Frank #7117 #2 / commit bf00ef1 in
                  /admin/photos). The detail modal itself still
                  doesn't have inline edit (admin-only editing lives
                  in /admin/photos), but the disclaimer framed it
                  as "next iteration" which is no longer accurate. */}
            </div>

            {/* §4 of 需求0827 — comments section. List (server-stored,
                HTML-escaped at the API → rendered with
                dangerouslySetInnerHTML so newlines work but no XSS
                slips through) + per-comment delete for owner/admin +
                new-comment form (auth-gated, maxLength 500 matching
                the server cap). */}
            <div className="mt-6 border-t border-white/10 pt-4">
              <h4 className="mb-3 text-sm font-medium text-white/80">
                💬 评论{' '}
                <span className="text-white/40">({comments.length})</span>
              </h4>

              <div className="mb-4 space-y-2">
                {commentsLoading && comments.length === 0 ? (
                  <p className="text-xs text-white/40">加载中…</p>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-white/40">还没有评论</p>
                ) : (
                  comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded border border-white/10 bg-white/[0.02] p-2"
                    >
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-white/40">
                          {c.user_id === sessionUserId
                            ? '你'
                            : `user_${c.user_id.slice(0, 4)}`}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-white/30 tabular-nums">
                            {new Date(c.created_at).toLocaleString(
                              'zh-CN',
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteComment(c.id)}
                            className="text-rose-300/60 transition hover:text-rose-300"
                            title="删除"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p
                        className="whitespace-pre-wrap break-words text-sm text-white/80"
                        // Server HTML-escapes content in
                        // /api/photos/[key]/comments POST (infra/007 CHECK
                        // + sanitizeContent). Stored string is safe to
                        // render directly.
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

              {sessionUserId ? (
                <div className="flex items-end gap-2">
                  <textarea
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="写下你的评论…"
                    className="flex-1 resize-none rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={postComment}
                    disabled={
                      commentPending ||
                      newCommentText.trim().length === 0
                    }
                    className="rounded bg-white px-3 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
                  >
                    {commentPending ? '发布中…' : '发布'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-white/40">
                  登录后可以发表评论。
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cluster modal — opened when the user clicks a multi-photo
          cluster on the globe. Shows the N photos that fall inside
          the cluster as a grid of thumbnails, so the cluster's
          "3" badge becomes a way to actually view those 3 photos
          instead of an opaque count. Click a thumbnail to close
          this modal and open the photo detail modal. */}
      {clusterOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          onClick={() => setClusterOpen(false)}
        >
          <div
            className="absolute inset-4 overflow-auto md:inset-12"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-light text-white">
                📍 同地点照片 · {clusterPhotos.length} 张
              </h2>
              <button
                type="button"
                onClick={() => setClusterOpen(false)}
                className="rounded border border-white/20 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
              >
                ✕ 关闭
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {clusterPhotos.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setClusterOpen(false);
                    // Frank #7187: remember the full cluster so
                    // the detail modal's prev/next can iterate
                    // through siblings at the same location.
                    setSelectedCluster(clusterPhotos);
                    setSelected(p);
                  }}
                  className="aspect-square overflow-hidden rounded border border-white/10 transition hover:border-white/40"
                  title={p.filename}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.thumbnail_url || p.public_url}
                    alt={p.filename}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* On This Day modal (§19). Same grid-of-thumbnails UX as the
          gallery modal but filtered to today's month-day across all
          years, grouped per year. Clicking a thumbnail closes this
          modal and opens the photo detail modal. */}
      {onThisDayOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          onClick={() => setOnThisDayOpen(false)}
        >
          <div
            className="absolute inset-4 overflow-auto md:inset-12"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-light text-white">
                📅{' '}
                {new Date().getMonth() + 1}月{new Date().getDate()}日 · 历史上
              </h2>
              <button
                type="button"
                onClick={() => setOnThisDayOpen(false)}
                className="rounded border border-white/20 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
              >
                ✕ 关闭
              </button>
            </div>
            {onThisDayGrouped.map((g) => (
              <div key={g.year} className="mb-8">
                <h3 className="mb-3 text-lg font-light text-white/80">
                  {g.year} 年 · {g.photos.length} 张
                </h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {g.photos.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        setOnThisDayOpen(false);
                        setSelected(p);
                      }}
                      className="aspect-square overflow-hidden rounded border border-white/10 transition hover:border-white/40"
                      title={p.filename}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.thumbnail_url || p.public_url}
                        alt={p.filename}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* §18 of 要件定義書 — Time Travel. Drives selectedDate forward
          from the earliest to the latest photo, syncing Globe +
          Timeline + photos in real time. Close resets selectedDate
          so the home page returns to "show all photos" state. */}
      <TimeTravel
        photos={photos}
        open={timeTravelOpen}
        onClose={() => {
          setTimeTravelOpen(false);
          setSelectedDate(null);
        }}
        onDateChange={setSelectedDate}
      />

      {/* §17 of 要件定義書 — Life Journey. Hierarchical Country → City
          panel of every distinct location Frank has visited, in
          chronological order. Clicking an entry drives selectedDate
          to the entry's midpoint so Globe + Timeline filter to that
          period. */}
      <LifeJourney
        photos={photos}
        open={lifeJourneyOpen}
        onClose={() => setLifeJourneyOpen(false)}
        onSelectEntry={(entry) => {
          const midMs =
            (entry.startDate.getTime() + entry.endDate.getTime()) / 2;
          setSelectedDate(new Date(midMs));
          setLifeJourneyOpen(false);
        }}
      />
    </>
  );
}

function formatMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}
