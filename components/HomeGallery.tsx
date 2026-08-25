'use client';

import { useEffect, useMemo, useState } from 'react';
import { Globe } from '@/components/Globe';
import { Timeline } from '@/components/Timeline';
import { createClient } from '@supabase/supabase-js';

type PhotoRow = {
  key: string;
  lat: number | null;
  lng: number | null;
  public_url: string;
  filename: string;
  taken_at: string | null;
  created_at: string;
  camera_make: string | null;
  camera_model: string | null;
  categories: string[] | null;
};

const TIMELINE_WINDOW_DAYS = 60;
const MS_PER_DAY = 24 * 3600 * 1000;

export function HomeGallery() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [selected, setSelected] = useState<PhotoRow | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setLoading(false);
      return;
    }
    const supabase = createClient(url, key);
    supabase
      .from('photos')
      .select(
        'lat, lng, public_url, filename, taken_at, created_at, camera_make, camera_model, categories',
      )
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) {
          console.error('[gallery fetch error]', error.message);
        } else if (data) {
          setPhotos(data as PhotoRow[]);
        }
        setLoading(false);
      });
  }, []);

  // ESC closes detail first, then gallery
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selected) setSelected(null);
      else if (galleryOpen) setGalleryOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, galleryOpen]);

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

  return (
    <>
      <div className="absolute inset-0 bottom-32">
        <Globe
          markers={markers}
          onMarkerSelect={(idx) => {
            const photo = visiblePhotos[idx];
            if (photo) setSelected(photo);
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center px-6 text-center">
        <p className="text-xs tracking-[0.4em] text-white/50 uppercase">
          写真で、暮らしの軌跡を残す
        </p>
        <h1 className="mt-3 text-2xl font-light text-white md:text-3xl">
          用照片，留下生活的痕迹。
        </h1>
        <p className="mt-2 max-w-sm text-sm text-white/50">
          {loading
            ? '加载中…'
            : photos.length === 0
              ? '首页 3D 地球仪 — 上传第一张照片点亮地点'
              : selectedDate
                ? `${visibleCount} 张照片在 ${formatMonth(selectedDate)} ± ${TIMELINE_WINDOW_DAYS / 2} 天窗口内`
                : `${photos.length} 张照片已点亮地点`}
        </p>
      </div>

      {/* Timeline — drives the globe marker filter. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-20">
        <Timeline
          photos={photos}
          selectedDate={selectedDate}
          onChange={setSelectedDate}
          windowDays={TIMELINE_WINDOW_DAYS}
        />
      </div>

      {/* Floating photo count button — opens gallery modal */}
      {!loading && photos.length > 0 && (
        <button
          onClick={() => setGalleryOpen(true)}
          className="pointer-events-auto fixed bottom-4 right-4 z-40 rounded-full border border-white/20 bg-black/70 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-sm transition hover:bg-black/90"
          aria-label="查看照片列表"
        >
          📷 {photos.length} 张照片
        </button>
      )}

      {/* Gallery modal — grid of thumbnails (shows ALL photos, not just date window) */}
      {galleryOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          onClick={() => setGalleryOpen(false)}
        >
          <div
            className="absolute inset-4 overflow-auto md:inset-12"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-light text-white">
                {photos.length} 张照片
              </h2>
              <button
                onClick={() => setGalleryOpen(false)}
                className="rounded border border-white/20 px-3 py-1 text-sm text-white/70 hover:bg-white/10"
              >
                ✕ 关闭
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {photos.map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    setGalleryOpen(false);
                    setSelected(p);
                  }}
                  className="aspect-square overflow-hidden rounded border border-white/10 transition hover:border-white/40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.public_url}
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
              {selected.lat != null && selected.lng != null && (
                <p>
                  📍 {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                </p>
              )}
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
    </>
  );
}

function formatMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}
