'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SpatialExplorer } from '@/components/SpatialExplorer';
import { Timeline } from '@/components/Timeline';
import { TimeTravel } from '@/components/TimeTravel';
import { LifeJourney } from '@/components/LifeJourney';
import { PhotoViewer, type PhotoRow } from '@/components/PhotoViewer';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { photoImageUrl } from '@/lib/photo-url';
import { t, type Locale } from '@/lib/i18n';

// Frank #7203 #3: ±30 天 → ±15 天. The constant is the total
// window size; Timeline.tsx halves it for the cyan range overlay
// (±windowDays/2) and for the matching filter inside the gallery.
// 60 days = ±30 (old), 30 days = ±15 (new).
const TIMELINE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 3600 * 1000;

export function HomeGallery({ locale }: { locale: Locale }) {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PhotoRow | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  // Frank #7509: cluster browsing now flows through the unified
  // PhotoViewer, which navigates visiblePhotos chronologically.
  // Cluster photos are typically adjacent in time at the same
  // location, so this naturally walks through them. No separate
  // cluster context state needed.
  const [onThisDayOpen, setOnThisDayOpen] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(false);
  const [clusterPhotos, setClusterPhotos] = useState<PhotoRow[]>([]);
  const [timeTravelOpen, setTimeTravelOpen] = useState(false);
  const [lifeJourneyOpen, setLifeJourneyOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // null = not loaded yet / guest; set after auth.getSession() resolves.
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

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
            'id, key, lat, lng, public_url, thumbnail_url, filename, taken_at, created_at, camera_make, camera_model, categories, location_name',
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
  // The PhotoViewer handles its own ESC internally (closes
  // itself); this effect only catches ESC for On This Day and
  // Cluster modals since those don't have an internal handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) return; // PhotoViewer owns ESC here
      if (onThisDayOpen) setOnThisDayOpen(false);
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

  // Frank #7509: likes / comments / drag / URL sync / aspect-ratio
  // reservation all moved into components/PhotoViewer.tsx. HomeGallery
  // just owns the gallery-level state (photos, selected photo,
  // timeline filter, search, sessionUserId, modals).

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

  // Phase 6: PhotoMap markers — same filteredPhotos as the Globe,
  // but with the richer shape PhotoMap needs (id, filename, taken_at
  // for future popups + click → photo detail). Phase 5.1 keeps these
  // derived from visiblePhotos so Timeline filter stays the single
  // source of truth (spec §22).
  const photoMapMarkers = useMemo(
    () =>
      visiblePhotos.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        filename: p.filename,
        taken_at: p.taken_at,
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

  // Frank #7509: cluster / swipe / prev-next logic moved into
  // components/PhotoViewer.tsx. HomeGallery now just renders the
  // viewer and passes visiblePhotos as the browse context.

  return (
    <>
      {/* Frank #7243 Task 4 mobile layout — sibling to the desktop
          wrapper below. Flex column so the hero (H1 + subtitle +
          2 CTAs) sits above the 40vh globe on 375/390/430 px
          viewports per doc Task 4 acceptance criteria. Hidden on
          desktop because the absolute-overlay layout below takes
          over. */}
      <div className="flex h-full w-full flex-col overflow-hidden lg:hidden">
        {/* Hero — title + subtitle + primary/secondary CTA. Doc
            Task 4 specifies ONE primary + ONE secondary (not
            three equal-weight actions). min-h-[44px] = the 44x44
            px touch-target requirement from doc Task 4. */}
        <div className="flex-shrink-0 px-4 pt-3 pb-2 text-center">
          <h1 className="text-xl font-light leading-tight text-black dark:text-white sm:text-2xl">
            用照片，留下生活的痕迹
          </h1>
          <p className="mx-auto mt-1.5 max-w-xs text-xs text-black/70 dark:text-white/70 sm:text-sm">
            自动按拍摄时间与地点，整理成可探索的人生地图
          </p>
          <div className="mt-3 flex flex-col items-stretch gap-2 px-2 sm:flex-row sm:items-center sm:justify-center sm:gap-3 sm:px-0">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-black px-6 text-sm font-medium text-white transition hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
            >
              {t(locale, 'hero.cta.primary')}
            </Link>
            <Link
              href="/welcome"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-black/20 px-6 text-sm text-black/80 transition hover:border-black/40 hover:text-black dark:border-white/20 dark:text-white/80 dark:hover:border-white/40 dark:hover:text-white"
            >
              {t(locale, 'hero.cta.secondary')}
            </Link>
          </div>
        </div>

        {/* Globe as visual background — 40vh per doc Task 4 */}
        <div className="relative h-[40vh] min-h-[260px] flex-shrink-0">
          <SpatialExplorer
            markers={markers}
            photoMapMarkers={photoMapMarkers}
            onMarkerSelect={handleMarkerSelect}
            onClusterClick={handleClusterClick}
          />
        </div>

        {/* Conditional buttons — only for signed-in users with
            photos. Per doc Task 4 mobile layout: [ 时间旅行 ] [
            人生足迹 ] below the globe. On This Day stays
            desktop-only (it's a discovery feature for power
            users, not a primary entry point). */}
        {sessionUserId && (
          <div className="flex flex-shrink-0 items-center justify-center gap-2 px-4 py-3">
            {photos.length > 0 && (
              <button
                type="button"
                onClick={() => setTimeTravelOpen(true)}
                aria-label="打开时间旅行"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-fuchsia-500/40 bg-white/95 px-4 text-xs text-fuchsia-700 dark:bg-black/40 dark:text-fuchsia-300/90"
              >
                ▶ 时间旅行
              </button>
            )}
            {photos.some((p) => p.location_name) && (
              <button
                type="button"
                onClick={() => setLifeJourneyOpen(true)}
                aria-label="打开人生足迹"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-emerald-500/40 bg-white/95 px-4 text-xs text-emerald-700 dark:bg-black/40 dark:text-emerald-300/90"
              >
                🌏 人生足迹
              </button>
            )}
          </div>
        )}

        {/* Timeline at the bottom of the mobile stack. */}
        <div className="pointer-events-auto flex-shrink-0">
          <Timeline
            photos={photos}
            selectedDate={selectedDate}
            onChange={setSelectedDate}
            windowDays={TIMELINE_WINDOW_DAYS}
          />
        </div>
      </div>

      {/* Frank #7243 Task 4: wrap the existing absolute-overlay
          layout in a hidden/lg:block divider. The wrapper is a
          logical hide/show toggle — no positioning — so the
          absolute children inside still resolve to the app/page.tsx
          parent (which is `relative h-[calc(100vh-65px)]`). On
          mobile (< lg) this wrapper is hidden and the new mobile
          layout (flex column, 40vh globe) below takes over. */}
      <div className="hidden lg:block">
      <div className="absolute inset-0">
        <SpatialExplorer
          markers={markers}
          photoMapMarkers={photoMapMarkers}
          onMarkerSelect={handleMarkerSelect}
          onClusterClick={handleClusterClick}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center px-6 text-center">
        <p className="text-xs tracking-[0.4em] text-black/50 dark:text-white/50 uppercase">
          {t(locale, 'hero.japaneseSubtitle')}
        </p>
        <h1 className="mt-3 text-2xl font-light text-black dark:text-white md:text-3xl">
          {t(locale, 'hero.title')}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-black/50 dark:text-white/50">
          {loading
            ? t(locale, 'hero.subtitle.loading')
            : photos.length === 0
              ? t(locale, 'hero.subtitle.empty')
              : trimmedQuery
                ? `${visibleCount} 张匹配 "${searchQuery.trim()}" · 共 ${photos.length} 张`
                : selectedDate
                  ? `${visibleCount} 张照片在 ${formatMonth(selectedDate)} ± ${TIMELINE_WINDOW_DAYS / 2} 天窗口内`
                  : t(locale, 'hero.subtitle.countNoFilter', { count: photos.length })}
        </p>
        {photos.length > 0 && (
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(locale, 'hero.searchPlaceholder')}
            aria-label={t(locale, 'hero.searchAriaLabel')}
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
      </div>

      

      {/* Frank #7509: Photo Detail Viewer replaced the inline modal
          (which only supported cluster-context prev/next and had no
          URL sync / keyboard nav / preload / aspect-ratio
          reservation). New component handles:
          - direction-aware horizontal slide + opacity fade
          - keyboard ←/→ / Esc
          - desktop left/right click zones
          - pointer drag (unified desktop + mobile) with 80px
            commit threshold
          - photo preload (prev/current/next + 2 further when
            network allows)
          - URL pushState → /p/{key}, browser Back/Forward syncs
          - likes/comments Map cache (no refetch flash on switch)
          - aspect-ratio reservation + retry on image error
          - photo list = visiblePhotos, so timeline filter and
            search query are respected.
          See components/PhotoViewer.tsx for full implementation. */}
      {selected && (
        <PhotoViewer
          photos={visiblePhotos}
          initialPhoto={selected}
          locale={locale}
          isSignedIn={Boolean(sessionUserId)}
          sessionUserId={sessionUserId}
          onClose={() => setSelected(null)}
        />
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
                    // Frank #7509: the PhotoViewer navigates
                    // visiblePhotos chronologically; cluster
                    // photos are adjacent in time at the same
                    // location, so this naturally walks through
                    // them.
                    setSelected(p);
                  }}
                  className="aspect-square overflow-hidden rounded border border-white/10 transition hover:border-white/40"
                  title={p.filename}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    // Frank #7243 Task 2: cluster thumbnails via
                    // the auth-gated proxy in 256 size — the grid
                    // renders dozens of thumbs so full-size
                    // originals would hammer R2.
                    src={photoImageUrl(p, '256')}
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
                        // Frank #7243 Task 2: on-this-day grid uses
                        // the 256 thumbnail via the auth proxy —
                        // same pattern as the cluster grid.
                        src={photoImageUrl(p, '256')}
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
