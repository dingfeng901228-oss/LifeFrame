'use client';

import { useEffect, useRef, useState } from 'react';
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
  | 'error'
  // Frank #7108 #1: new terminal state set when the user clicks
  // "取消上传" mid-flight. Same UI surface as 'partial' (some items
  // may have completed before the cancel flag was checked) but with
  // a distinct status colour so the user understands "I stopped
  // this on purpose, not because something broke".
  | 'cancelled';

export function UploadForm() {
  const [batchStatus, setBatchStatus] = useState<BatchStatus>('idle');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  // Frank #7131 #6: batch-level visibility. Defaults to 'private'
  // (matches the migration 004 default server-side). The useEffect
  // below auto-resets to a category-based default when the user
  // picks a category (person → unlisted, scenery → public) so the
  // default matches Frank's spec without forcing a manual visibility
  // radio on every photo. User can override per-photo via the per-
  // photo edit modal (Frank #7117 #2) after upload.
  const [visibility, setVisibility] = useState<
    'public' | 'unlisted' | 'private'
  >('private');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Batch-level manual time override. When set, this wins over each
  // photo's EXIF takenAt during upload. Empty string = fall back to
  // per-photo EXIF. The picker UI in the JSX below pre-fills from
  // the first photo's EXIF so users usually don't have to do anything.
  // Frank #7203 #1: the batch-level time picker now defaults to
  // the current local time (`nowAsDateTimeLocal()`) instead of
  // waiting for EXIF to prefill it. Reason: Frank wants the
  // upload form's default state to feel "right now, ready to go"
  // — user picks files, the picker already shows a sensible
  // timestamp, and the dropdown is there to override per-batch
  // (e.g. for old photos). The user can still hit "✕ 清除" to
  // fall back to per-photo EXIF time.
  const [takenAtManual, setTakenAtManual] = useState<string>(() =>
    nowAsDateTimeLocal(),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  // Frank #7108 #1: cancel flag — set true by the "取消上传" button
  // mid-upload, checked by the chunked loop in doUpload() to stop
  // scheduling new chunks. In-flight fetches continue (we don't
  // abort network requests without AbortController; aborting would
  // require threading AbortSignal through every fetch + the PUT).
  const cancelRef = useRef(false);

  // Frank #7131 #6: default visibility per category. Person photos
  // → unlisted (privacy-first for personal content); scenery photos
  // → public (open-by-default for landscapes). Empty categories →
  // leave current visibility alone (don't clobber the user's manual
  // selection if they cleared categories without changing visibility).
  // Note this effect auto-resets visibility on every category
  // change — if the user picks a category then later wants to
  // change visibility, they'd need to re-toggle the category or
  // can override per-photo via the edit modal post-upload. Fine
  // for now; can add an explicit override UI in a follow-up.
  useEffect(() => {
    if (categories.includes('person')) {
      setVisibility('unlisted');
    } else if (categories.includes('scenery')) {
      setVisibility('public');
    }
  }, [categories]);

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
    // Frank #7203 #1: refresh the batch-level time picker to the
    // current local time on every file pick. We don't preserve a
    // previous batch's manual time — picking new files means a new
    // batch with a new "now" anchor. The user can override by
    // editing the datetime-local dropdown (or clear to fall back
    // to per-photo EXIF, which the uploadOne path uses as the
    // `takenAtManual === ''` fallback).
    setTakenAtManual(nowAsDateTimeLocal());

    // Read EXIF for all files in parallel (fast — header-only reads).
    // We mutate `items` in place via index and re-publish the queue
    // after each item flips to 'ready' so the UI updates incrementally.
    //
    // Frank #7203 #1: the EXIF prefill of the top-level picker is
    // GONE. Previously this loop called `setTakenAtManual((prev) =>
    // (prev ? prev : iso))` to overlay EXIF time onto the empty
    // initial state. That made sense when the initial state was
    // '', but now the picker always carries a "now" anchor — and
    // EXIF time (which can be from years ago) clobbering that
    // anchor would silently hide the user's override. We still
    // record EXIF on each item so the uploadOne fallback path
    // (when the user clears the picker) keeps working.
    await Promise.all(
      items.map(async (_, i) => {
        try {
          const exifData = await extractExif(items[i].file);
          items[i].exif = exifData;
          if (exifData.takenAt) {
            items[i].takenAtManual = exifData.takenAt.slice(0, 16);
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
    batchVisibility: 'public' | 'unlisted' | 'private',
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
          // Frank #7203 #2: the upload form's useEffect flips
          // visibility to 'unlisted' whenever the 'person' category
          // is toggled on, but uploadOne was never sending the
          // value to the API — so the route defaulted to 'private'
          // and every person photo ended up invisible (private
          // 404s on /p/[key]). Pass it through so the server-side
          // default matches the client-side intent.
          visibility: batchVisibility,
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
    cancelRef.current = false;
    setBatchStatus('uploading');
    setError(null);

    // Skip already-done items on retry — after a cancel + 上传 click
    // the user shouldn't see the same photo PUT twice and pile up
    // duplicate keys in R2. 'error' items are retried (network blip,
    // signing hiccup); 'pending'/'extracting' shouldn't exist here
    // by the time we get to doUpload(), but if they do they're
    // treated as eligible.
    const eligible = queue.filter((q) => q.status !== 'done');

    // Chunked concurrency: MAX_CONCURRENCY PUTs in flight at once. R2
    // is happy with a few parallel uploads but 30 simultaneous PUTs
    // would saturate the connection pool. Frank #7108: cancelRef is
    // checked between chunks — in-flight chunks finish their work
    // (we don't abort fetches) but no new chunks start after cancel.
    const results: PromiseSettledResult<void>[] = [];
    for (let i = 0; i < eligible.length; i += MAX_CONCURRENCY) {
      if (cancelRef.current) break;
      const chunk = eligible.slice(i, i + MAX_CONCURRENCY);
      const settled = await Promise.allSettled(
        chunk.map((item) => uploadOne(item, picked, categories, takenAtManual, visibility)),
      );
      results.push(...settled);
    }

    const failures = results.filter((r) => r.status === 'rejected').length;
    if (cancelRef.current) {
      setBatchStatus('cancelled');
    } else if (failures === 0) {
      setBatchStatus('done');
    } else if (failures === eligible.length && eligible.length > 0) {
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
    // Frank #7131 #6: reset visibility to 'private' default along
    // with the other batch-level state so the next batch starts
    // from a clean slate. Without this, visibility persists across
    // resets and the user's next batch would silently inherit the
    // previous batch's visibility choice (especially confusing if
    // the last upload was 'unlisted' from a person photo).
    setVisibility('private');
    setTakenAtManual('');
    setError(null);
    cancelRef.current = false;
    if (inputRef.current) inputRef.current.value = '';
  }

  // Frank #7108 #1: re-pick flow — clear the current selection and
  // immediately re-open the native file picker, so the user can
  // swap their selection in one click instead of cancel-then-click.
  function reSelect() {
    setQueue([]);
    setPicked(null);
    setCategories([]);
    setTakenAtManual('');
    setError(null);
    cancelRef.current = false;
    setBatchStatus('idle');
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  }

  // Frank #7108 #1: cancel selection — clear without auto-opening
  // the picker. Returns to the empty 'idle' state so the user can
  // either walk away (using the "返回首页" link) or click the file
  // input manually.
  function cancelSelection() {
    reset();
  }

  // Frank #7108 #1: cancel mid-upload. Sets the cancel flag; the
  // current chunk finishes its parallel uploadOne() calls (each
  // uploadOne updates its own item's status to 'done' or 'error'
  // independently), then the loop sees cancelRef.current=true at
  // its next break check and bails. doUpload() then sets the
  // batchStatus to 'cancelled'.
  function cancelUpload() {
    cancelRef.current = true;
  }

  const doneCount = queue.filter((q) => q.status === 'done').length;
  const errorCount = queue.filter((q) => q.status === 'error').length;
  const eligibleCount = queue.filter((q) => q.status !== 'done').length;
  const busy = batchStatus === 'uploading';
  // Pickers visible whenever the user can still change batch-level
  // settings (location / time / categories) and have those changes
  // apply. Hidden during the actual upload run and after terminal
  // 'done' state — there they would just be confusing leftovers.
  // Note: 'cancelled' keeps the pickers visible so the user can
  // tweak settings before clicking 上传 again to resume the rest.
  const showPickers =
    queue.length > 0 &&
    (batchStatus === 'ready' || batchStatus === 'cancelled');

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
        {batchStatus === 'cancelled' && (
          <span className="text-amber-300">
            已取消 — 完成 {doneCount}/{queue.length}
          </span>
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
        <>
          <button
            type="button"
            onClick={doUpload}
            disabled={busy}
            className="block w-full rounded bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            上传 {queue.length} 张
          </button>
          {/* Frank #7108 #1: cancel/reselect/home row. Three secondary
              actions so the user can change their mind without having
              to upload first. 重新选择 clears + reopens the file
              picker; 取消选择 clears without auto-reopen; 返回首页
              is a plain anchor to leave the page entirely. */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reSelect}
              className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            >
              🔄 重新选择
            </button>
            <button
              type="button"
              onClick={cancelSelection}
              className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            >
              ✕ 取消选择
            </button>
            <a
              href="/"
              className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            >
              返回首页
            </a>
          </div>
        </>
      )}

      {/* Frank #7108 #1: cancel mid-upload. Stops scheduling new
          chunks; the current chunk finishes naturally. The button
          stays out of the file-input / picker area so it doesn't
          get hidden under batch-level controls. */}
      {batchStatus === 'uploading' && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={cancelUpload}
            className="rounded border border-rose-500/30 bg-rose-900/10 px-3 py-1.5 text-xs text-rose-300 transition hover:border-rose-500/50 hover:bg-rose-900/20"
          >
            ✕ 取消上传（已完成 {doneCount}/{queue.length}）
          </button>
          <a
            href="/"
            className="rounded border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
          >
            返回首页
          </a>
        </div>
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

      {/* Frank #7108 #1: post-upload action row. After partial/error
          the user can re-pick; after 'cancelled' they should also be
          able to retry the eligible (non-done) items in-place via
          the same 上传 button — so we expose a 继续上传 button here
          instead of forcing a re-pick. Returning home is always
          available. */}
      {(batchStatus === 'done' ||
        batchStatus === 'partial' ||
        batchStatus === 'error' ||
        batchStatus === 'cancelled') && (
        <div className="space-y-2">
          {batchStatus === 'cancelled' && eligibleCount > 0 && (
            <button
              type="button"
              onClick={doUpload}
              className="block w-full rounded bg-white px-4 py-3 text-sm font-medium text-black transition hover:bg-white/90"
            >
              继续上传剩余 {eligibleCount} 张
            </button>
          )}
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

// Frank #7203 #1: format `new Date()` as the local-time string
// that <input type="datetime-local"> expects ("YYYY-MM-DDTHH:MM").
// Using toISOString().slice(0, 16) would give UTC, which the
// datetime-local input then re-interprets as local — silently
// shifting the visible time by the user's UTC offset. Use local
// getters directly so the picker shows what `new Date()` actually
// is in the user's timezone.
function nowAsDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}