'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe } from '@/components/Globe';
import { Timeline } from '@/components/Timeline';
import { createClient } from '@supabase/supabase-js';

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

const TIMELINE_WINDOW_DAYS = 60;
const MS_PER_DAY = 24 * 3600 * 1000;

export function HomeGallery() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PhotoRow | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [onThisDayOpen, setOnThisDayOpen] = useState(false);
  const [clusterOpen, setClusterOpen] = useState(false);
  const [clusterPhotos, setClusterPhotos] = useState<PhotoRow[]>([]);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setFetchError('缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY');
      setLoading(false);
      return;
    }
    const supabase = createClient(url, key);
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

  // ESC closes detail first, then gallery
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  // Photos with GPS coords that also fall inside the selected date window
  // (if any). Empty selection = all photos. This is what drives the
  // globe markers — index-aligned with `markers` for the click handler.
  const visiblePhotos = useMemo(() => {
    let arr = photos.filter(
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
  }, [photos, selectedDate]);

  const markers = useMemo(
    () =>
      visiblePhotos.map((p) => ({
        location: [p.lat, p.lng] as [number, number],
      })),
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

  return (
    <>
      <div className="absolute inset-0">
        <Globe
          markers={markers}
          onMarkerSelect={(idx) => {
            const photo = visiblePhotos[idx];
            if (photo) setSelected(photo);
          }}
          onClusterClick={(indices) => {
            const photos = indices
              .map((i) => visiblePhotos[i])
              .filter(
                (p): p is PhotoRow & { lat: number; lng: number } =>
                  Boolean(p),
              );
            if (photos.length > 0) {
              setClusterPhotos(photos);
              setClusterOpen(true);
            }
          }}
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
              : selectedDate
                ? `${visibleCount} 张照片在 ${formatMonth(selectedDate)} ± ${TIMELINE_WINDOW_DAYS / 2} 天窗口内`
                : `${photos.length} 张照片已点亮地点`}
        </p>
        {onThisDayGrouped.length > 0 && (
          <button
            type="button"
            onClick={() => setOnThisDayOpen(true)}
            className="pointer-events-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-cyan-500/40 dark:border-cyan-400/30 bg-white/95 dark:bg-black/40 px-3 py-1.5 text-xs text-cyan-700 dark:text-cyan-300/90 backdrop-blur-sm transition hover:border-cyan-500 dark:hover:border-cyan-400/60 hover:text-cyan-700 dark:hover:text-cyan-300"
          >
            📅 历史上这一天 · {onThisDayGrouped.length} 个年份 ·{' '}
            {onThisDayGrouped.reduce((s, g) => s + g.photos.length, 0)} 张照片
          </button>
        )}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.public_url}
              alt={selected.filename}
              className="max-h-[75vh] w-full rounded object-contain"
            />
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
              <p className="pt-2 text-xs text-white/30">
                （分类编辑 + 删除功能下次迭代）
              </p>
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
    </>
  );
}

function formatMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}
