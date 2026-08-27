'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PhotoRow } from '@/lib/supabase';

/**
 * Admin photos client: renders the photo grid + handles bulk selection
 * + bulk delete. Bulk delete fires a POST to /api/admin/photos/delete
 * which deletes the DB rows + the R2 objects (original + thumbnail).
 *
 * After delete, the page calls router.refresh() so the server
 * component re-fetches and the per-route counts (Globe markers,
 * Timeline dots, location badges) all stay in sync without us having
 * to track them manually.
 */
type Props = { initialPhotos: PhotoRow[] };

export function AdminPhotosClient({ initialPhotos }: Props) {
  const [photos, setPhotos] = useState<PhotoRow[]>(initialPhotos);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const allSelected = useMemo(
    () => photos.length > 0 && selected.size === photos.length,
    [photos.length, selected.size],
  );

  function toggleOne(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      // If everything is selected, deselect all. Otherwise select all.
      if (s.size === photos.length) return new Set();
      return new Set(photos.map((p) => p.key));
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function openConfirm() {
    if (selected.size === 0) return;
    setConfirming(true);
  }

  function cancelConfirm() {
    setConfirming(false);
  }

  function confirmDelete() {
    if (selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/photos/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: Array.from(selected) }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `删除失败 ${res.status}: ${text.slice(0, 160)}`,
          );
        }
        const json = (await res.json()) as { deleted?: number };
        // Drop the deleted rows from local state immediately so the
        // grid feels responsive even before the server refresh lands.
        setPhotos((p) => p.filter((x) => !selected.has(x.key)));
        setSelected(new Set());
        setConfirming(false);
        // Refresh the server component so route-wide counts update
        // (Globe markers / Timeline dots etc. re-fetch on next nav).
        router.refresh();
        if (json.deleted === 0) {
          setError('没找到对应照片，可能已被删除');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (photos.length === 0) {
    return <p className="text-white/40">还没有照片</p>;
  }

  return (
    <div>
      {/* Sticky action bar — only shows when something is selected */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-30 mb-4 flex items-center gap-3 rounded-lg border border-amber-500/40 bg-[var(--bg-elevated)] px-4 py-2 text-sm shadow-xl backdrop-blur">
          <span className="text-white/80">
            已选择 <strong className="text-amber-300">{selected.size}</strong>{' '}
            张照片
          </span>
          <button
            type="button"
            onClick={clearSelection}
            disabled={pending}
            className="rounded border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            取消选择
          </button>
          <button
            type="button"
            onClick={openConfirm}
            disabled={pending}
            className="ml-auto rounded bg-rose-500/90 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
          >
            🗑️ 删除
          </button>
        </div>
      )}

      {/* Toolbar — count + select-all + filters (filters in §2.c follow-up) */}
      <div className="mb-4 flex items-center gap-4 text-sm text-white/40">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 cursor-pointer rounded border-white/30 bg-white/5 accent-amber-400"
          />
          <span>全选当前页面（{photos.length}）</span>
        </label>
        {selected.size > 0 && (
          <span className="text-white/30">
            · 已选 {selected.size}
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {photos.map((p) => (
          <PhotoTile
            key={p.id}
            photo={p}
            selected={selected.has(p.key)}
            onToggle={() => toggleOne(p.key)}
          />
        ))}
      </div>

      {/* Confirmation modal — §2.4 of 需求0827 requires二次确认
          before destructive bulk delete. */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={cancelConfirm}
        >
          <div
            className="w-full max-w-md rounded-lg border border-rose-500/40 bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-medium text-white">确认删除？</h3>
            <p className="mt-3 text-sm text-white/70">
              你即将删除{' '}
              <strong className="text-rose-300">{selected.size}</strong>{' '}
              张照片。删除后无法恢复。
            </p>
            <p className="mt-2 text-xs text-white/40">
              系统会同步删除 R2 原图、缩略图、以及未来关联的点赞与评论
              （ON DELETE CASCADE）。
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelConfirm}
                disabled={pending}
                className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={pending}
                className="rounded bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-50"
              >
                {pending ? '删除中…' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoTile({
  photo,
  selected,
  onToggle,
}: {
  photo: PhotoRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const cats = photo.categories ?? [];
  return (
    <label
      className={`group relative cursor-pointer overflow-hidden rounded border bg-black/30 transition ${
        selected
          ? 'border-amber-400/70 ring-2 ring-amber-400/40'
          : 'border-white/10 hover:border-white/30'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="absolute left-2 top-2 z-10 h-5 w-5 cursor-pointer rounded border-white/30 bg-black/60 accent-amber-400"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.thumbnail_url || photo.public_url}
        alt={photo.filename}
        className="aspect-square w-full object-cover"
        loading="lazy"
      />
      <div className="p-2 text-xs">
        <p className="truncate text-white/80" title={photo.filename}>
          {photo.filename}
        </p>
        {photo.taken_at && (
          <p className="mt-1 text-white/40 tabular-nums">
            📅 {new Date(photo.taken_at).toLocaleDateString('zh-CN')}
          </p>
        )}
        {photo.location_name && (
          <p className="truncate text-white/40" title={photo.location_name}>
            📍 {photo.location_name}
          </p>
        )}
        <p className="mt-1 text-[10px] uppercase tracking-wider text-white/30">
          {cats.includes('person') && '👤 '}
          {cats.includes('scenery') && '🏞️ '}
          · {photo.visibility}
        </p>
      </div>
    </label>
  );
}