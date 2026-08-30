'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Photo = {
  key: string;
  taken_at: string | null;
  created_at: string;
  public_url: string;
  thumbnail_url: string | null;
  filename: string;
};

type Props = {
  photos: Photo[];
  selectedDate: Date | null;
  onChange: (d: Date | null) => void;
  windowDays: number;
};

const MS_PER_DAY = 24 * 3600 * 1000;
// §6 of the spec calls for the timeline to span the whole life of the
// user. Left edge fixed at 1990-11 so it's stable across sessions —
// Frank always knows what the leftmost end means. Right edge is "now",
// recomputed per render so the track very slowly drifts forward as
// time passes (negligible between refreshes, but technically right).
const MIN_DATE = new Date('1990-11-01T00:00:00Z');

/**
 * Video-player-style progress bar Timeline.
 *
 * Single thin horizontal line spanning 1990-11 → now. Tiny vertical
 * marks on the bar indicate where photos exist (chapter markers).
 * A draggable knob (cyan dot) is the playhead. The cyan range overlay
 * is the ±windowDays/2 selection window. Hovering near a photo
 * triggers the existing thumbnail popup above the bar.
 *
 * Simpler than the previous design (which had year labels, an
 * elaborate handle with glow + ring + vertical line, and verbose
 * helper text). This matches what Frank asked for in #6980: "时间
 * 轨道改为一条线即可，类似播放器的进度条".
 */
export function Timeline({
  photos,
  selectedDate,
  onChange,
  windowDays,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Right edge = now (recomputed per render — cheap)
  const maxDate = useMemo(() => new Date(), []);
  const minDate = MIN_DATE;
  const totalSpan = maxDate.getTime() - minDate.getTime();

  // ── Photo positions on the track ─────────────────────────────────
  // Each photo maps to a percentage along the track. Sort by
  // position so we can render them in left-to-right order and
  // expose them to the thumbnail popup in chronological sequence.
  type PhotoPos = {
    key: string;
    pos: number;
    date: Date;
    publicUrl: string;
    thumbnailUrl: string | null;
    filename: string;
  };

  const photoPositions = useMemo<PhotoPos[]>(() => {
    return photos
      .map((p) => {
        const ts = p.taken_at || p.created_at;
        if (!ts) return null;
        const d = new Date(ts);
        if (isNaN(d.getTime())) return null;
        const pos = ((d.getTime() - minDate.getTime()) / totalSpan) * 100;
        return {
          key: p.key,
          pos,
          date: d,
          publicUrl: p.public_url,
          thumbnailUrl: p.thumbnail_url,
          filename: p.filename,
        };
      })
      .filter((x): x is PhotoPos => x !== null)
      .sort((a, b) => a.pos - b.pos);
  }, [photos, minDate, totalSpan]);

  // Photos inside the selected window — these are the candidates for
  // the thumbnail popup above the track. Same window logic as the
  // gallery's visiblePhotos filter so the timeline popup and the
  // globe markers stay in sync.
  const visiblePositions = useMemo(() => {
    if (!selectedDate) return [];
    const halfWindowMs = (windowDays / 2) * MS_PER_DAY;
    return photoPositions.filter((p) => {
      const diff = Math.abs(p.date.getTime() - selectedDate.getTime());
      return diff <= halfWindowMs;
    });
  }, [photoPositions, selectedDate, windowDays]);

  const positionFor = useCallback(
    (d: Date) =>
      Math.max(
        0,
        Math.min(100, ((d.getTime() - minDate.getTime()) / totalSpan) * 100),
      ),
    [minDate, totalSpan],
  );

  const dateFromClientX = useCallback(
    (clientX: number): Date | null => {
      if (!trackRef.current) return null;
      const rect = trackRef.current.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const t =
        minDate.getTime() + Math.max(0, Math.min(1, x)) * totalSpan;
      return new Date(t);
    },
    [minDate, totalSpan],
  );

  // ── Drag-to-scrub (same pattern as Globe.tsx, no setPointerCapture) ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      setDragging(true);
      const date = dateFromClientX(e.clientX);
      if (date) onChange(date);

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp, {
        once: true,
      });
      window.addEventListener('pointercancel', handleWindowPointerUp, {
        once: true,
      });
    },
    [dateFromClientX, onChange],
  );

  const handleWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const date = dateFromClientX(e.clientX);
      if (date) onChange(date);
    },
    [dateFromClientX, onChange],
  );

  const handleWindowPointerUp = useCallback(() => {
    setDragging(false);
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('pointercancel', handleWindowPointerUp);
  }, []);

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, []);

  const handlePos = selectedDate ? positionFor(selectedDate) : null;
  const halfWindowPct = (windowDays / 2 / (totalSpan / MS_PER_DAY)) * 100;
  const rangeStart =
    handlePos !== null ? Math.max(0, handlePos - halfWindowPct) : null;
  const rangeWidth =
    handlePos !== null ? Math.min(100, halfWindowPct * 2) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2 pt-1">
      {/* Compact header — just the date range. No instructions, no
          "筛选：..." copy. The interaction is self-evident once you
          touch the bar. */}
      <div className="mb-1.5 flex items-center justify-between text-[10px] tracking-wider text-black/60 dark:text-white/55 tabular-nums">
        <span>{formatShort(minDate)}</span>
        {selectedDate && (
          <span className="text-cyan-600 dark:text-cyan-300/80">
            {formatShort(selectedDate)} ± {Math.round(windowDays / 2)} 天
          </span>
        )}
        <span>{formatShort(maxDate)}</span>
      </div>

      <div className="relative">
        {/* Thumbnail popup — floats above the bar at the playhead's
            position, only when scrubbing near photos. Same UX as the
            previous design. */}
        {selectedDate &&
          handlePos !== null &&
          visiblePositions.length > 0 && (
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left: `${handlePos}%`,
                bottom: '100%',
                transform: 'translateX(-50%)',
                marginBottom: '8px',
              }}
            >
              <div className="flex gap-1.5 rounded-lg border border-cyan-500 dark:border-cyan-400/40 bg-white/95 dark:bg-black/85 p-1.5 shadow-lg backdrop-blur-sm">
                {visiblePositions.slice(0, 3).map((p) => (
                  <img
                    key={p.key}
                    src={p.thumbnailUrl || p.publicUrl}
                    alt={p.filename}
                    className="h-12 w-12 rounded object-cover ring-1 ring-black/10 dark:ring-white/10"
                    title={p.filename}
                  />
                ))}
                {visiblePositions.length > 3 && (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-white/95 dark:bg-black/60 text-xs text-black/65 dark:text-white/70 ring-1 ring-black/10 dark:ring-white/10">
                    +{visiblePositions.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Bar */}
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          // Frank #7243 Task 8 (B4): a11y for the timeline track.
          // Treats it as a slider — keyboard users can still scrub by
          // pointer (the SVG isn't focusable; mouse-only on desktop).
          // aria-valuetext carries the human-readable date so screen
          // readers announce "2026.03" instead of a raw ms epoch.
          // The photo keyframe marks stay aria-hidden via their
          // pointer-events-none parent — they're visual chapter
          // ticks, not interactive elements.
          role="slider"
          aria-label="时间轴 — 点击或拖动选择日期"
          aria-valuemin={minDate.getTime()}
          aria-valuemax={maxDate.getTime()}
          aria-valuenow={selectedDate ? selectedDate.getTime() : minDate.getTime()}
          aria-valuetext={
            selectedDate ? formatShort(selectedDate) : '未选择'
          }
          tabIndex={0}
          className={`relative h-1.5 touch-none select-none rounded-full bg-black/10 dark:bg-white/10 transition ${
            dragging
              ? 'cursor-grabbing bg-black/15 dark:bg-white/15'
              : 'cursor-pointer hover:bg-black/15 dark:hover:bg-white/15'
          }`}
        >
          {/* Photo keyframe marks — chapter-marker style vertical
              ticks just above the bar. Same width as the bar (1.5px)
              and a bit taller (8px) so they stick up from the line.
              One per photo. pointer-events: none so they don't
              interfere with drag. */}
          {photoPositions.map((p) => (
            <div
              key={`mark-${p.key}`}
              className="pointer-events-none absolute h-2 w-0.5 -translate-x-1/2 rounded-sm bg-cyan-600/80 dark:bg-cyan-400/70"
              style={{
                left: `${p.pos}%`,
                top: '-2px',
              }}
              title={p.filename}
            />
          ))}

          {/* Selected range overlay — the ±windowDays/2 highlight. */}
          {rangeStart !== null && rangeWidth !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 rounded-full bg-cyan-500/40 dark:bg-cyan-400/40"
              style={{
                left: `${rangeStart}%`,
                width: `${rangeWidth}%`,
              }}
            />
          )}

          {/* Playhead — single small cyan circle on the bar. Grows
              slightly on hover/drag for tactile feedback. pointer-
              events: none so the wrapper's onPointerDown handles
              the drag instead of this element swallowing it. */}
          {handlePos !== null && (
            <div
              className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_6px_rgba(8,145,178,0.5)] dark:shadow-[0_0_6px_rgba(103,232,249,0.7)] ring-2 ring-white/40 dark:ring-black/40 transition-transform ${
                dragging ? 'scale-125' : 'scale-100'
              }`}
              style={{ left: `${handlePos}%` }}
            />
          )}
        </div>
      </div>

      {/* Compact footer — just the clear button when a date is
          selected. No "drag hint" copy; the cursor change is enough. */}
      <div className="mt-1 flex items-center justify-end text-[10px]">
        {selectedDate && (
          <button
            type="button"
            onChange={() => onChange(null)}
            onClick={() => onChange(null)}
            className="text-cyan-600 dark:text-cyan-300/70 transition hover:text-cyan-700 dark:hover:text-cyan-300"
          >
            ✕ 清除筛选
          </button>
        )}
      </div>
    </div>
  );
}

function formatShort(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}