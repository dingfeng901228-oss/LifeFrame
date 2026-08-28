'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { PhotoRow } from '@/lib/supabase';

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

  // Frank #7108 #3: bulk-set categories to a single value across
  // every selected photo. Replaces each photo's categories array
  // with [target] (not toggle/append) — Frank #7108 phrased this
  // as "修改为 人物 或者 风景", which is a SET semantic. The route
  // handler whitelists categories server-side so even if a future
  // client sends a bogus value it'll be silently dropped.
  function applyBulkCategory(
    target: 'person' | 'scenery',
    visibility: 'public' | 'unlisted' | 'private' | null,
  ) {
    if (selected.size === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        // Frank #7131 #5: include visibility in the updates payload
        // only when the user picked a non-null target. Null means
        // "保持原样" — the bulk-update route already whitelists
        // visibility (private/unlisted/public) so we send only
        // valid values; passing null = omit the key from updates.
        const updates: {
          categories: string[];
          visibility?: 'public' | 'unlisted' | 'private';
        } = {
          categories: [target],
        };
        if (visibility) updates.visibility = visibility;

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
            `批量分类失败 ${res.status}: ${text.slice(0, 160)}`,
          );
        }
        const json = (await res.json()) as { updated?: number };
        // Patch local state immediately so per-tile category
        // badges (👤 / 🏞️) and visibility label flip on next
        // paint; router.refresh() syncs /stats / /timeline counts.
        setPhotos((ps) =>
          ps.map((p) =>
            selected.has(p.key)
              ? {
                  ...p,
                  categories: [target],
                  ...(visibility ? { visibility } : {}),
                }
              : p,
          ),
        );
        setSelected(new Set());
        setCategoryModalOpen(false);
        // Frank #7115: clear confirm-step targets so reopening
        // the modal lands back on step 1 (the picker), not on a
        // stale step 2 with previous run's targets still set.
        setCategoryTarget(null);
        setVisibilityTarget(null);
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
              📁 批量分类
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

      {/* Frank #7108 #3 / fixed in #7115: bulk-categories modal is
          now a two-step picker→confirm flow. The original single-
          step design (pick → apply in one click) felt too eager to
          Frank — he explicitly wanted a 确认 step between picking
          the target category and the action firing (ref: #7115
          "批量分类的弹框，选完分类之后，没有确认按键"). Step 1
          (categoryTarget = null) shows the picker cards; clicking
          a card sets categoryTarget and the modal swaps to step 2,
          a confirm surface with the chosen target highlighted and
          two buttons: ← 返回 / 确认应用. Only the 确认应用 button
          calls applyBulkCategory. Backdrop click + the step-1
          取消 button both reset both modal states. The single-
          modal-instance design (vs two stacked modals) keeps the
          state machine flat: just (open, target). */}
      {categoryModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => {
            if (pending) return;
            setCategoryModalOpen(false);
            setCategoryTarget(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-amber-500/40 bg-[var(--bg-elevated)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {!categoryTarget ? (
              // Step 1 — picker
              <>
                <h3 className="text-xl font-medium text-white">🔁 批量分类</h3>
                <p className="mt-3 text-sm text-white/70">
                  将选中的{' '}
                  <strong className="text-amber-300">{selected.size}</strong>{' '}
                  张照片的分类替换为：
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCategoryTarget('person')}
                    disabled={pending}
                    className="rounded-lg border border-white/15 bg-white/[0.04] p-4 text-center transition hover:border-cyan-400/60 hover:bg-cyan-400/10 disabled:opacity-50"
                  >
                    <span className="block text-3xl" aria-hidden="true">
                      👤
                    </span>
                    <span className="mt-2 block text-sm font-medium text-white">
                      人物
                    </span>
                    <span className="mt-1 block text-[10px] uppercase tracking-wider text-white/40">
                      person
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryTarget('scenery')}
                    disabled={pending}
                    className="rounded-lg border border-white/15 bg-white/[0.04] p-4 text-center transition hover:border-emerald-400/60 hover:bg-emerald-400/10 disabled:opacity-50"
                  >
                    <span className="block text-3xl" aria-hidden="true">
                      🏞️
                    </span>
                    <span className="mt-2 block text-sm font-medium text-white">
                      风景
                    </span>
                    <span className="mt-1 block text-[10px] uppercase tracking-wider text-white/40">
                      scenery
                    </span>
                  </button>
                </div>
                <p className="mt-4 text-xs text-white/40">
                  选定之后会有确认步骤。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCategoryModalOpen(false);
                      setCategoryTarget(null);
                      setVisibilityTarget(null);
                    }}
                    disabled={pending}
                    className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              // Step 2 — confirm
              <>
                <h3 className="text-xl font-medium text-white">确认应用？</h3>
                <p className="mt-3 text-sm text-white/70">
                  将选中的{' '}
                  <strong className="text-amber-300">{selected.size}</strong>{' '}
                  张照片的分类替换为：
                </p>
                <div className="mt-4 flex items-center justify-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-5">
                  <span className="text-4xl" aria-hidden="true">
                    {categoryTarget === 'person' ? '👤' : '🏞️'}
                  </span>
                  <div className="text-left">
                    <span className="block text-base font-medium text-white">
                      {categoryTarget === 'person' ? '人物' : '风景'}
                    </span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-white/40">
                      {categoryTarget}
                    </span>
                  </div>
                </div>
                <p className="mt-4 text-xs text-white/40">
                  设为同一分类时无变化；切换时直接替换（不合并）。
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryTarget(null)}
                    disabled={pending}
                    className="rounded border border-white/15 px-4 py-2 text-sm text-white/80 transition hover:border-white/40 hover:text-white disabled:opacity-50"
                  >
                    ← 返回
                  </button>
                  <button
                    type="button"
                    onClick={() => applyBulkCategory(categoryTarget, visibilityTarget)}
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
    </div>
  );
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
        className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded bg-black/60 text-base text-white/70 transition hover:bg-black/80 hover:text-white"
        title="编辑照片信息"
      >
        ✏️
      </button>
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