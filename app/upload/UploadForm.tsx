'use client';

import { useRef, useState } from 'react';
import { extractExif, type PhotoExif } from '@/lib/exif';
import { MapPicker, type PickedLocation } from '@/components/MapPicker';

const MAX_BATCH = 30;
const MAX_CONCURRENCY = 3;
const NOMINATIM_UA = 'LifeFrame/0.1 (https://lifeframe.frank2025.com)';

type FileStatus = 'pending' | 'extracting' | 'ready' | 'uploading' | 'done' | 'error';

type QueueItem = {
  id: string;
  file: File;
  exif: PhotoExif | null;
  takenAtManual: string;
  status: FileStatus;
  error?: string;
  key?: string;
  publicUrl?: string;
};

type BatchStatus =
  | 'idle'
  | 'ready'
  | 'uploading'
  | 'done'
  | 'partial'
  | 'error';

export function UploadForm() {
  const [batchStatus, setBatchStatus] = useState<BatchStatus>('idle');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Batch-level manual time override. When set, this wins over each
  // photo's EXIF takenAt during upload. Empty string = fall back to
  // per-photo EXIF. The picker UI in the JSX below pre-fills from
  // the first photo's EXIF so users usually don't have to do anything.
  const [takenAtManual, setTakenAtManual] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) {
      setQueue([]);
      setBatchStatus('idle');
      return;
    }
    if (files.length > MAX_BATCH) {
      setError(`最多 ${MAX_BATCH} 张，你选了 ${files.length} 张`);
      // Reset the input so the user can re-pick
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    // Seed the queue. Items start as 'extracting' until EXIF is read.
    const items: QueueItem[] = files.map((f, i) => ({
      id: `${Date.now()}-${i}-${f.name}`,
      file: f,
      exif: null,
      takenAtManual: '',
      status: 'extracting',
    }));
    setQueue(items);
    setBatchStatus('ready');
    // Pre-fill the batch-level time picker from the first photo's EXIF.
    // If EXIF has no taken_at we leave the picker empty (the
    // upload still uses each photo's EXIF as a fallback below).
    setTakenAtManual('');

    // Read EXIF for all files in parallel (fast — header-only reads).
    // We mutate `items` in place via index and re-publish the queue
    // after each item flips to 'ready' so the UI updates incrementally.
    await Promise.all(
      items.map(async (_, i) => {
        try {
          const exifData = await extractExif(items[i].file);
          items[i].exif = exifData;
          if (exifData.takenAt) {
            const iso = exifData.takenAt.slice(0, 16);
            items[i].takenAtManual = iso;
            // Prefill the top-level picker only if the user hasn't
            // already picked something for the previous batch.
            setTakenAtManual((prev) => (prev ? prev : iso));
          }
        } catch {
          // No EXIF — that's fine, file will just upload without GPS/time.
        }
        items[i].status = 'ready';
        setQueue([...items]);
      }),
    );
  }

  // ── Use current location ──────────────────────────────────────
  // Browser Geolocation API → lat/lng → Nominatim reverse geocode
  // (zh) → set as the picked location. Same path the map picker takes,
  // but triggered from the device's GPS instead of a click.
  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('浏览器不支持定位');
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&accept-language=zh`,
            { headers: { 'User-Agent': NOMINATIM_UA } },
          );
          if (res.ok) {
            const data = (await res.json()) as { display_name?: string };
            const name =
              data.display_name
                ?.split(',')
                .slice(0, 2)
                .map((s) => s.trim())
                .join(', ') || fallback;
            setPicked({ lat, lng, name });
          } else {
            setPicked({ lat, lng, name: fallback });
          }
        } catch {
          setPicked({ lat, lng, name: fallback });
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setError(`定位失败：${err.message}`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  function toggleCategory(tag: 'person' | 'scenery') {
    setCategories((c) =>
      c.includes(tag) ? c.filter((x) => x !== tag) : [...c, tag],
    );
  }

  async function uploadOne(
    item: QueueItem,
    batchPicked: PickedLocation | null,
    batchCategories: string[],
    batchTakenAtManual: string,
  ): Promise<void> {
    setQueue((q) =>
      q.map((it) =>
        it.id === item.id ? { ...it, status: 'uploading' } : it,
      ),
    );
    try {
      // Final payload: batch-level picked location overrides EXIF GPS
      // for every photo. Same story for time: the top-level time
      // picker (takenAtManual) wins over EXIF; if neither is set we
      // just don't send takenAt and the Supabase column stays null.
      const finalLat = batchPicked?.lat ?? item.exif?.lat;
      const finalLng = batchPicked?.lng ?? item.exif?.lng;
      const finalTaken = batchTakenAtManual
        ? new Date(batchTakenAtManual).toISOString()
        : item.exif?.takenAt;

      const signRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type || 'application/octet-stream',
          exif: {
            takenAt: finalTaken,
            lat: finalLat,
            lng: finalLng,
            make: item.exif?.make,
            model: item.exif?.model,
            locationName: batchPicked?.name,
          },
          categories:
            batchCategories.length > 0 ? batchCategories : undefined,
        }),
      });
      if (!signRes.ok) {
        const text = await signRes.text();
        throw new Error(`signing ${signRes.status}: ${text.slice(0, 120)}`);
      }
      const { url, key, publicUrl } = (await signRes.json()) as {
        url: string;
        key: string;
        publicUrl: string;
      };

      const put = await fetch(url, {
        method: 'PUT',
        body: item.file,
      });
      if (!put.ok) {
        const text = await put.text();
        throw new Error(`PUT ${put.status}: ${text.slice(0, 120)}`);
      }

      setQueue((q) =>
        q.map((it) =>
          it.id === item.id
            ? { ...it, status: 'done', key, publicUrl }
            : it,
        ),
      );

      // Generate a 256x256 webp thumbnail in the background. §23 of
      // the spec: original-only on the home page is a perf cliff once
      // Frank has 30+ photos — R2 bandwidth + decode cost blow up.
      // Failures here are non-fatal: the upload already succeeded and
      // the UI falls back to public_url when thumbnail_url is null.
      // We don't surface a per-file error in the queue because the
      // user-visible state already reads "done".
      try {
        const thumbRes = await fetch('/api/process-thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!thumbRes.ok) {
          const text = await thumbRes.text();
          console.warn(
            '[thumbnail generation non-fatal]',
            item.id,
            thumbRes.status,
            text.slice(0, 120),
          );
        }
      } catch (err) {
        console.warn(
          '[thumbnail generation threw]',
          item.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setQueue((q) =>
        q.map((it) =>
          it.id === item.id ? { ...it, status: 'error', error: msg } : it,
        ),
      );
      throw err; // propagate so Promise.allSettled can count the failure
    }
  }

  async function doUpload() {
    if (queue.length === 0) return;
    setBatchStatus('uploading');
    setError(null);

    // Chunked concurrency: MAX_CONCURRENCY PUTs in flight at once. R2
    // is happy with a few parallel uploads but 30 simultaneous PUTs
    // would saturate the connection pool.
    const results: PromiseSettledResult<void>[] = [];
    for (let i = 0; i < queue.length; i += MAX_CONCURRENCY) {
      const chunk = queue.slice(i, i + MAX_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map((item) => uploadOne(item, picked, categories, takenAtManual)),
      );
      results.push(...settled);
    }

    const failures = results.filter((r) => r.status === 'rejected').length;
    if (failures === 0) {
      setBatchStatus('done');
    } else if (failures === queue.length) {
      setBatchStatus('error');
    } else {
      setBatchStatus('partial');
    }
  }

  function reset() {
    setBatchStatus('idle');
    setQueue([]);
    setPicked(null);
    setCategories([]);
    setTakenAtManual('');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const doneCount = queue.filter((q) => q.status === 'done').length;
  const errorCount = queue.filter((q) => q.status === 'error').length;
  const busy = batchStatus === 'uploading';
  const showPickers =
    queue.length > 0 && batchStatus !== 'uploading' && batchStatus !== 'done';

  return (
    <div className="space-y-6">
      {/* File input — `multiple` enables batch selection */}
      <label className="block">
        <span className="sr-only">选择图片（最多 {MAX_BATCH} 张）</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onChange}
          disabled={busy}
          className="block w-full cursor-pointer rounded border border-white/15 bg-white/5 px-3 py-3 text-sm text-white file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-2 file:text-black hover:bg-white/10 disabled:opacity-50"
        />
      </label>

      <div className="text-xs text-white/40">一次最多 {MAX_BATCH} 张</div>

      <div className="min-h-6 text-sm">
        {batchStatus === 'idle' && <span className="text-white/40">等选择</span>}
        {batchStatus === 'ready' && (
          <span className="text-sky-300">
            已读取 {queue.length} 张 EXIF — 可改地点/分类后点上传
          </span>
        )}
        {batchStatus === 'uploading' && (
          <span className="text-sky-300">
            上传中… {doneCount}/{queue.length}
            {errorCount > 0 && (
              <span className="ml-2 text-rose-300">失败 {errorCount}</span>
            )}
          </span>
        )}
        {batchStatus === 'done' && (
          <span className="text-emerald-300">
            全部上传成功 ✅ {queue.length} 张
          </span>
        )}
        {batchStatus === 'partial' && (
          <span className="text-amber-300">
            部分成功：{doneCount} ✅, {errorCount} ❌
          </span>
        )}
        {batchStatus === 'error' && (
          <span className="text-rose-300">批量上传失败，请看下方列表</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Batch-level location picker. If unset, each photo falls back
          to its own EXIF GPS. Two ways to populate it: pick on a map,
          or use the device's GPS via the geolocation API. */}
      {showPickers && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
          <p className="mb-2 text-white/50">
            拍摄地点（整批共用 — 可选；不选则每张用各自 EXIF GPS）
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {picked ? (
                <span className="text-white/80">
                  📍{' '}
                  <span className="font-medium text-white">
                    {picked.name}
                  </span>
                  <span className="ml-2 text-white/40">
                    ({picked.lat.toFixed(4)}, {picked.lng.toFixed(4)})
                  </span>
                </span>
              ) : (
                <span className="text-white/40">
                  不选 → 每张用各自 EXIF GPS
                </span>
              )}
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <button
                type="button"
                onClick={useCurrentLocation}
                disabled={busy || locating}
                className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                {locating ? '定位中…' : '📍 使用当前位置'}
              </button>
              <button
                type="button"
                onClick={() => setMapOpen(true)}
                disabled={busy}
                className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                {picked ? '🗺️ 更改地点' : '🗺️ 选择地点'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time picker — mirrors the location-picker UX: optional, panel-
          styled, "current value" display on the left, datetime-local
          input + clear button on the right. We prefill from EXIF
          takenAt so users usually don't have to do anything. */}
      {showPickers && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
          <p className="mb-2 text-white/50">
            拍摄时间（整批共用 — 可选；不选则每张用各自 EXIF 时间）
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              {takenAtManual ? (
                <span className="text-white/80">
                  📅{' '}
                  <span className="font-medium text-white">
                    {formatShortDateTime(takenAtManual)}
                  </span>
                </span>
              ) : (
                <span className="text-white/40">
                  不选 → 每张用各自 EXIF 时间
                </span>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <input
                type="datetime-local"
                value={takenAtManual}
                onChange={(e) => setTakenAtManual(e.target.value)}
                className="rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-white"
              />
              {takenAtManual && (
                <button
                  type="button"
                  onClick={() => setTakenAtManual('')}
                  className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white"
                >
                  ✕ 清除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Categories — multi-tag for the whole batch. §9 of the spec:
          "采用多标签设计而不是单选。例如照片 A 同时归类人物 + 风景。"
          We persist to photos.categories via the API route. */}
      {showPickers && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
          <p className="mb-2 text-white/50">
            分类（多选 — 整批共用）
          </p>
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={categories.includes('person')}
                onChange={() => toggleCategory('person')}
                className="h-4 w-4 rounded border-white/30 bg-white/5 accent-cyan-400"
              />
              <span className="text-white/80">👤 人物</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={categories.includes('scenery')}
                onChange={() => toggleCategory('scenery')}
                className="h-4 w-4 rounded border-white/30 bg-white/5 accent-cyan-400"
              />
              <span className="text-white/80">🏞️ 风景</span>
            </label>
          </div>
        </div>
      )}

      {batchStatus === 'ready' && (
        <button
          type="button"
          onClick={doUpload}
          disabled={busy}
          className="block w-full rounded bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          上传 {queue.length} 张
        </button>
      )}

      {/* Per-file progress list */}
      {queue.length > 0 && (
        <div className="space-y-1 text-xs">
          {queue.map((item, idx) => (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${
                item.status === 'done'
                  ? 'border-emerald-500/30 bg-emerald-900/10 text-emerald-200'
                  : item.status === 'error'
                    ? 'border-rose-500/30 bg-rose-900/10 text-rose-200'
                    : item.status === 'uploading'
                      ? 'border-sky-500/30 bg-sky-900/10 text-sky-200'
                      : 'border-white/10 bg-white/[0.02] text-white/70'
              }`}
            >
              <span className="truncate">
                <span className="mr-1 text-white/40">{idx + 1}.</span>
                {item.file.name}
                {item.exif?.lat != null && item.exif?.lng != null && (
                  <span className="ml-2 text-white/40">
                    · GPS {item.exif.lat.toFixed(2)},{' '}
                    {item.exif.lng.toFixed(2)}
                  </span>
                )}
              </span>
              <span className="flex-shrink-0 text-right">
                {item.status === 'extracting' && '读 EXIF…'}
                {item.status === 'ready' && '待上传'}
                {item.status === 'uploading' && '上传中…'}
                {item.status === 'done' && '✅'}
                {item.status === 'error' && (
                  <span title={item.error}>❌ 失败</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {(batchStatus === 'done' ||
        batchStatus === 'partial' ||
        batchStatus === 'error') && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:bg-white/5"
          >
            再选一批
          </button>
          <a
            href="/"
            className="rounded border border-white/30 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:border-white/40 hover:text-white"
          >
            返回首页
          </a>
        </div>
      )}

      {mapOpen && (
        <MapPicker
          initial={picked}
          onSelect={(loc) => {
            setPicked(loc);
            setMapOpen(false);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}
    </div>
  );
}

function formatShortDateTime(iso: string): string {
  // iso like "2026-08-26T18:54" — render as "2026.08.26 18:54"
  return iso.replace(/-/g, '.').replace('T', ' ');
}