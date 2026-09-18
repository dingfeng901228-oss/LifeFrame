'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PhotoRow } from '@/lib/supabase';
import { photoImageUrl } from '@/lib/photo-url';
import { MapPicker } from '@/components/MapPicker';

/**
 * Admin photos client: renders the photo grid + bulk-selection
 * toolbar with mass actions for delete and category changes.
 *
 * - Bulk delete: POST /api/admin/photos/delete (removes DB rows
 *   + R2 originals + thumbnails).
 * - Bulk categories (Frank #7108 #3): POST /api/admin/photos/
 *   bulk-update with updates.categories = ['person' | 'scenery']
 *   to REPLACE each selected photo's category array. Whitelist
 *   enforcement lives server-side in the route handler, not here.
 *
 * Both mass actions call router.refresh() after success so the
 * Server Component re-fetches and route-wide counts (Globe
 * markers, Timeline dots, location badges) stay in sync without
 * us having to track them manually.
 */
type Props = { initialPhotos: PhotoRow[] };

export function AdminPhotosClient({ initialPhotos }: Props) {
  const [photos, setPhotos] = useState<PhotoRow[]>(initialPhotos);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  // Frank #7108 #3: bulk-update categories modal. Opens from the
  // sticky action bar; the modal itself lives near the delete
  // confirm modal so the two mass actions share visual precedent.
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  // Frank #7115: target picked in step 1 of the bulk-category
  // modal. null = still on the picker (step 1); non-null = user
  // advanced to the confirm step (step 2) with that target.
  // Driving the step transition this way keeps the modal single-
  // instance — the picker and confirm content swap in place via
  // conditional rendering rather than two stacked modals.
  const [categoryTarget, setCategoryTarget] = useState<
    'person' | 'scenery' | null
  >(null);
  // Frank #7131 #5: optional visibility target for the bulk-
  // category modal. null = "保持原样" (don't touch visibility;
  // only category gets updated on save). Non-null = set each
  // selected photo's visibility to this value. State persists
  // across the modal's picker→confirm step so the user can
  // adjust visibility in either step.
  const [visibilityTarget, setVisibilityTarget] = useState<
    'public' | 'unlisted' | 'private' | null
  >(null);
  // Frank #0906: bulk modal now also edits capture time + place,
  // not just categories/visibility. Two-step state machine is
  // driven by `bulkStep` (1 = pick everything, 2 = confirm) now
  // that a category pick is no longer mandatory — the user may
  // want to fix only the date or only the place.
  //   bulkTakenAt:  <input type="datetime-local"> value, '' = keep
  //   bulkLocation: free-text place name, '' = keep
  //   bulkLat/Lng:  optional coordinates as strings (parsed on
  //                 apply); '' = keep existing coordinates
  const [bulkStep, setBulkStep] = useState<1 | 2>(1);
  const [bulkTakenAt, setBulkTakenAt] = useState<string>('');
  const [bulkLocation, setBulkLocation] = useState<string>('');
  const [bulkLat, setBulkLat] = useState<string>('');
  const [bulkLng, setBulkLng] = useState<string>('');

  /** Reset every transient field of the bulk-edit modal. Called on
   *  every close path (backdrop click, 取消, successful apply) so
   *  reopening lands on a clean step-1 picker instead of stale
   *  targets from the previous run. */
  function resetBulkModal() {
    setCategoryModalOpen(false);
    setBulkStep(1);
    setCategoryTarget(null);
    setVisibilityTarget(null);
    setBulkTakenAt('');
    setBulkLocation('');
    setBulkLat('');
    setBulkLng('');
  }

  /** True when the admin has picked at least one thing to change.
   *  Gates the step-1 「下一步」 button so an empty apply can't be
   *  fired (the route would reject it anyway — this is the UX
   *  half of the same guard). */
  const hasBulkChanges = Boolean(
    categoryTarget ||
      visibilityTarget ||
      bulkTakenAt.trim() ||
      bulkLocation.trim() ||
      bulkLat.trim() ||
      bulkLng.trim(),
  );

  // Frank #7117 #2: per-photo edit modal. The 'editingPhoto'
  // gate drives the conditional rendering — null = no modal;
  // non-null = open and editing that specific photo. Form fields
  // are kept as 4 sibling useState calls (one per column) rather
  // than a single object so each input can bind cleanly to its
  // own setter and we don't fight stale-closure issues inside
  // async save transitions.
  const [editingPhoto, setEditingPhoto] = useState<PhotoRow | null>(
    null,
  );
  const [editTakenAt, setEditTakenAt] = useState<string>('');
  const [editLocationName, setEditLocationName] = useState<string>('');
  // Frank #7292: lat/lng + MapPicker state. Initialized from
  // photo.lat / photo.lng on openEdit so the map opens centered
  // on the existing pin (no need to re-search).
  const [editLat, setEditLat] = useState<number | null>(null);
  const [editLng, setEditLng] = useState<number | null>(null);
  const [editMapOpen, setEditMapOpen] = useState(false);
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [editVisibility, setEditVisibility] = useState<
    'public' | 'unlisted' | 'private'
  >('private');
  const [editError, setEditError] = useState<string | null>(null);
  // Frank #7131 Task #4: filter chips for categories + visibility.
  // Client-side filter over the 500-photo limit (no server paging).
  // Multi-select Sets — empty Set means "no filter on this axis"
  // (so users can filter on just categories, just visibility,
  // both, or neither).
  const [filterCategories, setFilterCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [filterVisibility, setFilterVisibility] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Frank #7131 Task #4: filter photos client-side. A photo matches
  // if its categories (any) ∈ filterCategories AND its visibility
  // ∈ filterVisibility. The filter is a pure view transform —
  // bulk-update / delete still operate on `selected` regardless
  // of filter (no behavior change for those flows).
  const filteredPhotos = useMemo(() => {
    let arr = photos;
    if (filterCategories.size > 0) {
      arr = arr.filter((p) =>
        (p.categories ?? []).some((c) => filterCategories.has(c)),
      );
    }
    if (filterVisibility.size > 0) {
      arr = arr.filter((p) => filterVisibility.has(p.visibility));
    }
    return arr;
  }, [photos, filterCategories, filterVisibility]);

  // Frank #7131 Task #4: select-all now operates on filteredPhotos
  // (the visible set) instead of all photos. "全选当前页面"
  // means "select everything I'm currently looking at".
  const allSelected = useMemo(
    () =>
      filteredPhotos.length > 0 &&
      filteredPhotos.every((p) => selected.has(p.key)),
    [filteredPhotos, selected],
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
      // Frank #7131 Task #4: select-all now operates on
      // filteredPhotos. If every visible photo is already
      // selected → deselect just those (preserves any selection
      // outside the current filter window). Otherwise → add
      // every visible photo to the selection (merges with any
      // pre-existing selection outside the filter).
      const allVisibleSelected =
        filteredPhotos.length > 0 &&
        filteredPhotos.every((p) => s.has(p.key));
      if (allVisibleSelected) {
        const next = new Set(s);
        for (const p of filteredPhotos) next.delete(p.key);
        return next;
      }
      const next = new Set(s);
      for (const p of filteredPhotos) next.add(p.key);
      return next;
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

  // Frank #7108 #3 / Frank #0906: bulk-apply the admin's chosen
  // changes across every selected photo. Any subset of:
  //   - categories   (replace with a single value)
  //   - visibility   (optional)
  //   - taken_at     (optional, uniform timestamp)
  //   - location_name + optional lat/lng
  // At least one field must be set — the guard below rejects a
  // no-op apply so the user can't fire an empty write.
  // The route handler whitelists / validates every field
  // server-side.
  function applyBulkUpdates() {
    if (selected.size === 0) return;

    const updates: {
      categories?: string[];
      visibility?: 'public' | 'unlisted' | 'private';
      taken_at?: string;
      location_name?: string;
      lat?: number;
      lng?: number;
    } = {};

    if (categoryTarget) updates.categories = [categoryTarget];
    if (visibilityTarget) updates.visibility = visibilityTarget;
    if (bulkTakenAt.trim()) {
      const parsed = new Date(bulkTakenAt);
      if (!isNaN(parsed.getTime())) updates.taken_at = parsed.toISOString();
    }
    const loc = bulkLocation.trim();
    if (loc) updates.location_name = loc;
    const latNum = bulkLat.trim() === '' ? NaN : Number(bulkLat);
    const lngNum = bulkLng.trim() === '' ? NaN : Number(bulkLng);
    if (Number.isFinite(latNum)) updates.lat = latNum;
    if (Number.isFinite(lngNum)) updates.lng = lngNum;

    if (Object.keys(updates).length === 0) {
      setError('请至少选择一项要修改的内容');
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/photos/bulk-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keys: Array.from(selected),
            updates,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `批量修改失败 ${res.status}: ${text.slice(0, 160)}`,
          );
        }
        const json = (await res.json()) as { updated?: number };
        // Patch local state immediately so per-tile badges / dates
        // / place labels flip on next paint; router.refresh() syncs
        // /stats / /timeline counts.
        setPhotos((ps) =>
          ps.map((p) =>
            selected.has(p.key)
              ? {
                  ...p,
                  ...(updates.categories
                    ? { categories: updates.categories }
                    : {}),
                  ...(updates.visibility
                    ? { visibility: updates.visibility }
                    : {}),
                  ...(updates.taken_at ? { taken_at: updates.taken_at } : {}),
                  ...(updates.location_name
                    ? { location_name: updates.location_name }
                    : {}),
                  ...(updates.lat !== undefined ? { lat: updates.lat } : {}),
                  ...(updates.lng !== undefined ? { lng: updates.lng } : {}),
                }
              : p,
          ),
        );
        setSelected(new Set());
        resetBulkModal();
        router.refresh();
        if (json.updated === 0) {
          setError('没找到对应照片，可能已被删除');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  // Frank #7117 #2: per-photo edit modal — single-photo
  // correction surface for taken_at / location_name / categories
  // / visibility. Distinct from the bulk-categorize modal (Task
  // #3 / #7115) which only does categories. Saves via the same
  // /api/admin/photos/bulk-update endpoint (single-element keys
  // array) — that route's whitelisting already covers all four
  // fields after the taken_at extension in commit handling Task
  // #2.
  function openEdit(photo: PhotoRow) {
    // Convert ISO timestamp → datetime-local input format
    // ("YYYY-MM-DDTHH:MM") in the user's local timezone.
    // datetime-local inputs are wall-clock-aware; the server
    // route accepts ISO strings via `new Date(taken_at)` so the
    // roundtrip is symmetrical (server stores ISO, client picks
    // local-time wall clock).
    let takenAtLocal = '';
    if (photo.taken_at) {
      try {
        const d = new Date(photo.taken_at);
        if (!isNaN(d.getTime())) {
          const pad = (n: number) => String(n).padStart(2, '0');
          takenAtLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      } catch {
        // Leave takenAtLocal empty — admin can re-pick a date.
      }
    }
    setEditingPhoto(photo);
    setEditTakenAt(takenAtLocal);
    setEditLocationName(photo.location_name ?? '');
    setEditLat(photo.lat ?? null);
    setEditLng(photo.lng ?? null);
    setEditMapOpen(false);
    setEditCategories([...((photo.categories as string[]) ?? [])]);
    setEditVisibility(
      (photo.visibility as 'public' | 'unlisted' | 'private') ?? 'private',
    );
    setEditError(null);
  }

  function cancelEdit() {
    setEditingPhoto(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingPhoto) return;
    setEditError(null);

    // Build the same shape the bulk-update route whitelists.
    // Server-side: categories strictly {person, scenery},
    // visibility strictly {public, unlisted, private},
    // location_name string → null on empty, taken_at ISO → null
    // on empty.
    const updates: Record<string, unknown> = {};
    const cats = editCategories.filter(
      (c): c is 'person' | 'scenery' => c === 'person' || c === 'scenery',
    );
    updates.categories = Array.from(new Set(cats));
    if (['public', 'unlisted', 'private'].includes(editVisibility)) {
      updates.visibility = editVisibility;
    }
    const trimmedLoc = editLocationName.trim().slice(0, 240);
    updates.location_name = trimmedLoc.length > 0 ? trimmedLoc : null;
    // Frank #7292: persist the lat/lng from MapPicker (if set).
    // Range-checks live in the API route (whitelist); null here
    // means "don't touch this field" so partial edits work.
    if (editLat !== null && Number.isFinite(editLat)) {
      updates.lat = editLat;
    }
    if (editLng !== null && Number.isFinite(editLng)) {
      updates.lng = editLng;
    }
    if (editTakenAt.trim() === '') {
      updates.taken_at = null;
    } else {
      const parsed = new Date(editTakenAt);
      if (!isNaN(parsed.getTime())) {
        updates.taken_at = parsed.toISOString();
      }
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/photos/bulk-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keys: [editingPhoto.key],
            updates,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `保存失败 ${res.status}: ${text.slice(0, 160)}`,
          );
        }
        // Patch local state immediately so the per-tile location
        // name / category badges / date flip without waiting for
        // router.refresh() to land. Visibility needs the literal
        // union — `updates` is typed Record<string, unknown> so
        // direct read widens to `string`, which can't reconcile
        // with PhotoRow.visibility's narrowed type. Cast to the
        // literal union here; the bulk-update route already
        // validates the value server-side.
        setPhotos((ps) =>
          ps.map((p) =>
            p.id === editingPhoto.id
              ? {
                  ...p,
                  taken_at:
                    updates.taken_at !== undefined
                      ? (updates.taken_at as string | null)
                      : p.taken_at,
                  location_name:
                    updates.location_name !== undefined
                      ? (updates.location_name as string | null)
                      : p.location_name,
                  categories: updates.categories as string[],
                  visibility:
                    (updates.visibility as
                      | 'public'
                      | 'unlisted'
                      | 'private') ?? p.visibility,
                }
              : p,
          ),
        );
        setEditingPhoto(null);
        router.refresh();
      } catch (err) {
        setEditError(err instanceof Error ? err.message : String(err));
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
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCategoryModalOpen(true)}
              disabled={pending}
              className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 transition hover:border-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              📁 批量修改
            </button>
            <button
              type="button"
              onClick={openConfirm}
              disabled={pending}
              className="rounded bg-rose-500/90 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              🗑️ 删除
            </button>
          </div>
        </div>
      )}

      {/* Toolbar — count + select-all. Frank #7131 Task #4
          implemented the filter chips right below; the comment
          here no longer refers to a §2.c follow-up. */}
      <div className="mb-4 flex items-center gap-4 text-sm text-white/40">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="h-4 w-4 cursor-pointer rounded border-white/30 bg-white/5 accent-amber-400"
          />
          <span>全选当前页面（{filteredPhotos.length}）</span>
        </label>
        {selected.size > 0 && (
          <span className="text-white/30">
            · 已选 {selected.size}
          </span>
        )}
      </div>

      {/* Frank #7131 Task #4: filter chip row. Two axes
          (categories + visibility) as multi-select chips; click to
          toggle inclusion in that axis's filter Set. Empty Set
          on an axis = "no filter on that axis" — supports filter
          on just categories, just visibility, both, or neither. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <FilterGroup
          label="分类"
          options={[
            { value: 'person', label: '👤 人物' },
            { value: 'scenery', label: '🏞️ 风景' },
          ]}
          selected={filterCategories}
          onChange={setFilterCategories}
        />
        <FilterGroup
          label="可见性"
          options={[
            { value: 'public', label: '🌍 公开' },
            { value: 'unlisted', label: '🔗 不公开' },
            { value: 'private', label: '🔒 私密' },
          ]}
          selected={filterVisibility}
          onChange={setFilterVisibility}
        />
        {(filterCategories.size > 0 || filterVisibility.size > 0) && (
          <button
            type="button"
            onClick={() => {
              setFilterCategories(new Set());
              setFilterVisibility(new Set());
            }}
            className="text-white/40 underline transition hover:text-white/70"
          >
            清空筛选
          </button>
        )}
        {filteredPhotos.length !== photos.length && (
          <span className="text-white/30">
            · 匹配 {filteredPhotos.length} / {photos.length}
          </span>
        )}
      </div>

      {error && (
        <p className="mb-4 rounded border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filteredPhotos.map((p) => (
          <PhotoTile
            key={p.id}
            photo={p}
            selected={selected.has(p.key)}
            onToggle={() => toggleOne(p.key)}
            onEdit={() => openEdit(p)}
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

      {/* Frank #7108 #3 / #7115 / Frank #0906: bulk-edit modal.
          Two-step picker→confirm flow (#7115 added the confirm step
          after Frank asked for one: "批量分类的弹框，选完分类之后，
          没有确认按键"). Frank #0906 extended it from
          categories-only to a general bulk edit: categories,
          capture time (taken_at), place (location_name + optional
          lat/lng) and visibility can each be set or left alone.
          Step 1 = pick everything (bulkStep === 1); the 「下一步」
          button is disabled until at least one change is picked
          (hasBulkChanges). Step 2 = confirm, listing exactly what
          will be written; only 确认应用 calls applyBulkUpdates.
          Every close path goes through resetBulkModal() so
          reopening lands on a clean step 1. The single-instance
          design (vs two stacked modals) keeps the state machine
          flat: (open, step, categoryTarget, visibilityTarget,
          bulkTakenAt, bulkLocation, bulkLat, bulkLng). */}
      {categoryModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => {
            if (pending) return;
            resetBulkModal();
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-amber-500/40 bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {bulkStep === 1 ? (
              // Step 1 — picker. Every field is optional: the user
              // may fix only the date, only the place, only the
              // category, or any combination. Nothing is written
              // until the confirm step.
              <>
                <h3 className="text-xl font-medium text-white">🔁 批量修改</h3>
                <p className="mt-3 text-sm text-white/70">
                  将对选中的{' '}
                  <strong className="text-amber-300">{selected.size}</strong>{' '}
                  张照片应用以下修改（留空的项目保持不变）：
                </p>

                {/* 分类 — 可选。点击选中，再点一次取消。 */}
                <p className="mt-5 text-xs text-white/40">分类（可选）：</p>
                <div className="mt-1 grid grid-cols-2 gap-3">
                  {(
                    [
                      {
                        value: 'person',
                        label: '人物',
                        emoji: '👤',
                        activeCls: 'border-cyan-400/60 bg-cyan-400/10',
                      },
                      {
                        value: 'scenery',
                        label: '风景',
                        emoji: '🏞️',
                        activeCls: 'border-emerald-400/60 bg-emerald-400/10',
                      },
                    ] as const
                  ).map((opt) => {
                    const active = categoryTarget === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setCategoryTarget(active ? null : opt.value)
                        }
                        disabled={pending}
                        className={`rounded-lg border p-3 text-center transition disabled:opacity-50 ${
                          active
                            ? `${opt.activeCls} ring-2 ring-amber-400/30`
                            : 'border-white/15 bg-white/[0.04] hover:border-white/40'
                        }`}
                      >
                        <span className="block text-2xl" aria-hidden="true">
                          {opt.emoji}
                        </span>
                        <span className="mt-1 block text-sm font-medium text-white">
                          {opt.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-white/40">
                          {opt.value}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* 拍摄时间 — 可选。批量设为同一时刻。 */}
                <p className="mt-5 text-xs text-white/40">拍摄时间（可选）：</p>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="datetime-local"
                    value={bulkTakenAt}
                    onChange={(e) => setBulkTakenAt(e.target.value)}
                    disabled={pending}
                    aria-label="批量设置拍摄时间"
                    className="min-w-0 flex-1 rounded border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white [color-scheme:dark] disabled:opacity-50"
                  />
                  {bulkTakenAt && (
                    <button
                      type="button"
                      onClick={() => setBulkTakenAt('')}
                      disabled={pending}
                      className="rounded border border-white/15 px-2 py-2 text-xs text-white/70 transition hover:border-white/40 hover:text-white disabled:opacity-50"
                    >
                      清除
                    </button>
                  )}
                </div>

                {/* 拍摄地点 — 可选。地点名 + 可选经纬度。 */}
                <p className="mt-4 text-xs text-white/40">拍摄地点（可选）：</p>
                <input
                  type="text"
                  value={bulkLocation}
                  onChange={(e) => setBulkLocation(e.target.value)}
                  placeholder="地点名，例如：北京市, 中国"
                  disabled={pending}
                  aria-label="批量设置拍摄地点名称"
                  className="mt-1 w-full rounded border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 disabled:opacity-50"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="any"
                    value={bulkLat}
                    onChange={(e) => setBulkLat(e.target.value)}
                    placeholder="纬度 lat（可选）"
                    disabled={pending}
                    aria-label="批量设置纬度"
                    className="rounded border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 disabled:opacity-50"
                  />
                  <input
                    type="number"
                    step="any"
                    value={bulkLng}
                    onChange={(e) => setBulkLng(e.target.value)}
                    placeholder="经度 lng（可选）"
                    disabled={pending}
                    aria-label="批量设置经度"
                    className="rounded border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder-white/30 disabled:opacity-50"
                  />
                </div>
                <p className="mt-1 text-[11px] text-white/35">
                  只填地点名 → 仅更新名称；同时填经纬度 → 也会移动地球上的标记点。
                </p>
                {/* 可见性 — 可选。保持原样 = 不改。 */}
                <p className="mt-5 text-xs text-white/40">可见性（可选）：</p>
                <div className="mt-1 grid grid-cols-4 gap-2">
                  {(
                    [
                      { value: null, label: '保持原样', emoji: '·' },
                      { value: 'public', label: '公开', emoji: '🌍' },
                      { value: 'unlisted', label: '不公开', emoji: '🔗' },
                      { value: 'private', label: '私密', emoji: '🔒' },
                    ] as const
                  ).map((opt) => {
                    const active = visibilityTarget === opt.value;
                    return (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => setVisibilityTarget(opt.value)}
                        disabled={pending}
                        className={`rounded-lg border p-2 text-center transition disabled:opacity-50 ${
                          active
                            ? 'border-amber-400/60 bg-amber-500/15 ring-2 ring-amber-400/30'
                            : 'border-white/15 bg-white/[0.04] hover:border-white/40 hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="block text-lg" aria-hidden="true">
                          {opt.emoji}
                        </span>
                        <span className="mt-1 block text-[11px] font-medium text-white">
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-4 text-xs text-white/40">
                  选定之后会有确认步骤。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={resetBulkModal}
                    disabled={pending}
                    className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkStep(2)}
                    disabled={pending || !hasBulkChanges}
                    title={hasBulkChanges ? undefined : '请至少选择一项要修改的内容'}
                    className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-400 disabled:opacity-40"
                  >
                    下一步 →
                  </button>
                </div>
              </>
            ) : (
              // Step 2 — confirm
              <>
                <h3 className="text-xl font-medium text-white">确认应用？</h3>
                <p className="mt-3 text-sm text-white/70">
                  将对选中的{' '}
                  <strong className="text-amber-300">{selected.size}</strong>{' '}
                  张照片应用以下修改：
                </p>
                <ul className="mt-4 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-white">
                  {categoryTarget && (
                    <li className="flex items-center gap-2">
                      <span aria-hidden="true">
                        {categoryTarget === 'person' ? '👤' : '🏞️'}
                      </span>
                      <span>
                        分类 →{' '}
                        <strong>
                          {categoryTarget === 'person' ? '人物' : '风景'}
                        </strong>
                      </span>
                    </li>
                  )}
                  {bulkTakenAt && (
                    <li className="flex items-center gap-2">
                      <span aria-hidden="true">🕒</span>
                      <span>
                        拍摄时间 → <strong>{formatBulkDateTime(bulkTakenAt)}</strong>
                      </span>
                    </li>
                  )}
                  {bulkLocation.trim() && (
                    <li className="flex items-center gap-2">
                      <span aria-hidden="true">📍</span>
                      <span>
                        拍摄地点 → <strong>{bulkLocation.trim()}</strong>
                      </span>
                    </li>
                  )}
                  {(bulkLat.trim() || bulkLng.trim()) && (
                    <li className="flex items-center gap-2">
                      <span aria-hidden="true">🧭</span>
                      <span>
                        坐标 →{' '}
                        <strong>
                          lat {bulkLat.trim() || '—'}, lng {bulkLng.trim() || '—'}
                        </strong>
                      </span>
                    </li>
                  )}
                  {visibilityTarget && (
                    <li className="flex items-center gap-2">
                      <span aria-hidden="true">
                        {visibilityTarget === 'public'
                          ? '🌍'
                          : visibilityTarget === 'unlisted'
                            ? '🔗'
                            : '🔒'}
                      </span>
                      <span>
                        可见性 →{' '}
                        <strong>
                          {visibilityTarget === 'public'
                            ? '公开'
                            : visibilityTarget === 'unlisted'
                              ? '不公开'
                              : '私密'}
                        </strong>
                      </span>
                    </li>
                  )}
                </ul>
                <p className="mt-4 text-xs text-white/40">
                  分类为直接替换（不合并）；时间 / 地点会覆盖所选照片的原值。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkStep(1)}
                    disabled={pending}
                    className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
                  >
                    ← 返回
                  </button>
                  <button
                    type="button"
                    onClick={applyBulkUpdates}
                    disabled={pending}
                    className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-400 disabled:opacity-50"
                  >
                    {pending ? '应用中…' : '确认应用'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Frank #7117 #2: per-photo edit modal — the "fix this
          ONE image right now" surface. Single modal-instance,
          swap in/out via `editingPhoto` gate. Layout: photo meta
          (key + filename) at top, then a 4-field form (taken_at
          / location_name / categories / visibility) prefilled
          from the photo, then 取消 / 保存 actions. Saving calls
          the same /api/admin/photos/bulk-update endpoint the
          bulk-categorize modal uses, just with a single-element
          keys array. */}
      {editingPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={cancelEdit}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-amber-500/40 bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-medium text-white">✏️ 编辑照片信息</h3>
            <p className="mt-1 truncate text-xs text-white/40">
              key: <code className="font-mono">{editingPhoto.key}</code>
              {editingPhoto.filename && (
                <>
                  {' · '}
                  <span title={editingPhoto.filename}>
                    {editingPhoto.filename}
                  </span>
                </>
              )}
            </p>
            <div className="mt-5 space-y-4">
              {/* 拍摄时间 */}
              <label className="block">
                <span className="block text-xs text-white/60">
                  📅 拍摄时间
                </span>
                <input
                  type="datetime-local"
                  value={editTakenAt}
                  onChange={(e) => setEditTakenAt(e.target.value)}
                  className="mt-1 block w-full rounded border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white"
                />
                {editTakenAt === '' && (
                  <span className="mt-1 block text-[10px] text-white/40">
                    留空保存 = 清除时间
                  </span>
                )}
              </label>
              {/* 拍摄地点 */}
              <label className="block">
                <span className="block text-xs text-white/60">
                  📍 拍摄地点
                </span>
                <input
                  type="text"
                  value={editLocationName}
                  onChange={(e) => setEditLocationName(e.target.value)}
                  placeholder="留空清除"
                  maxLength={240}
                  className="mt-1 block w-full rounded border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white placeholder-white/30"
                />
              </label>
              {/* 分类 — two-checkbox picker, mirrors the upload
                  form's batch-level category control style. */}
              <div>
                <span className="block text-xs text-white/60">🏷️ 分类</span>
                <div className="mt-1 flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editCategories.includes('person')}
                      onChange={() => {
                        setEditCategories((cs) =>
                          cs.includes('person')
                            ? cs.filter((c) => c !== 'person')
                            : [...cs, 'person'],
                        );
                      }}
                      className="h-4 w-4 rounded border-white/30 bg-white/5 accent-cyan-400"
                    />
                    <span className="text-sm text-white/80">👤 人物</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editCategories.includes('scenery')}
                      onChange={() => {
                        setEditCategories((cs) =>
                          cs.includes('scenery')
                            ? cs.filter((c) => c !== 'scenery')
                            : [...cs, 'scenery'],
                        );
                      }}
                      className="h-4 w-4 rounded border-white/30 bg-white/5 accent-emerald-400"
                    />
                    <span className="text-sm text-white/80">🏞️ 风景</span>
                  </label>
                </div>
              </div>
              {/* 可见性 — radio group, three options. Default
                  'private' is the migration 004 default. */}
              <div>
                <span className="block text-xs text-white/60">
                  🔒 可见性
                </span>
                <div className="mt-1 flex gap-3 text-sm">
                  {(['public', 'unlisted', 'private'] as const).map((v) => (
                    <label
                      key={v}
                      className="flex cursor-pointer items-center gap-1.5"
                    >
                      <input
                        type="radio"
                        name="edit-visibility"
                        checked={editVisibility === v}
                        onChange={() => setEditVisibility(v)}
                        className="h-4 w-4 border-white/30 bg-white/5 accent-amber-400"
                      />
                      <span className="text-white/80">
                        {v === 'public'
                          ? '🌍 公开'
                          : v === 'unlisted'
                            ? '🔗 不公开'
                            : '🔒 私密'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {editError && (
              <p className="mt-4 rounded border border-rose-500/30 bg-rose-900/20 p-3 text-sm text-rose-300">
                {editError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={pending}
                className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={pending}
                className="rounded bg-amber-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-amber-400 disabled:opacity-50"
              >
                {pending ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Frank #7292: edit-modal MapPicker — opens when the
          edit form's "🗭 在地图上确认位置" button is clicked.
          Rendered as a sibling of the editingPhoto dialog so it
          stacks above (MapPicker itself is fixed/inset-0). Prefills
          with the photo's existing lat/lng so re-opening doesn't
          snap to (0,0). OnSelect writes name + lat/lng back to
          edit state and closes the picker; saveEdit (above) then
          persists them via the bulk-update API. */}
      {editMapOpen && (
        <MapPicker
          initial={
            editLat !== null && editLng !== null
              ? { lat: editLat, lng: editLng, name: editLocationName }
              : null
          }
          onSelect={(loc) => {
            setEditLocationName(loc.name);
            setEditLat(loc.lat);
            setEditLng(loc.lng);
            setEditMapOpen(false);
          }}
          onClose={() => setEditMapOpen(false)}
        />
      )}
    </div>
  );
}

/** Render a `<input type="datetime-local">` value as a readable
 *  `YYYY-MM-DD HH:mm` string for the confirm step. Falls back to
 *  the raw value if it somehow doesn't parse. */
function formatBulkDateTime(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PhotoTile({
  photo,
  selected,
  onToggle,
  onEdit,
}: {
  photo: PhotoRow;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
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
      {/* Frank #7117 #2: per-photo edit button — sits in the
          top-right corner opposite the bulk-select checkbox.
          preventDefault + stopPropagation so clicking it doesn't
          also trigger the parent <label>'s selection-toggle
          behaviour (the label wraps the checkbox + image so a
          click anywhere on the tile toggles selection — without
          stopPropagation, clicking ✏️ would also toggle). */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onEdit();
        }}
        // Frank #7243 Task 8 (B4) a11y: icon-only edit button gets
        // an explicit aria-label so screen readers announce
        // "编辑照片信息" instead of just "pencil emoji". title
        // attribute stays for mouse hover preview; aria-label is
        // the canonical accessible name.
        aria-label="编辑照片信息"
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded bg-black/60 text-base text-white/70 transition hover:bg-black/80 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400"
        title="编辑照片信息"
      >
        ✏️
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        // Frank #7243 Task 2: admin grid tiles use the 256
        // thumbnail via the auth proxy. Admin sees all photos
        // (private / unlisted / public) so this is the proxy's
        // primary auth check landing — every tile fetch hits
        // /api/photos/[key]/image?w=256 with admin cookies.
        src={photoImageUrl(photo, '256')}
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

// Frank #7131 Task #4: multi-select filter chip group used by the
// admin/photos toolbar (categories + visibility axes). Each option
// toggles inclusion in the parent's Set<string> state. Visually:
// rounded-full pill, amber-tinted when active, white-bordered when
// inactive. `label` is the axis heading text shown to the left.
function FilterGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/50">{label}：</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (active) next.delete(opt.value);
                else next.add(opt.value);
                onChange(next);
              }}
              className={`rounded-full border px-2.5 py-0.5 transition ${
                active
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                  : 'border-white/15 bg-white/[0.04] text-white/60 hover:border-white/40 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}