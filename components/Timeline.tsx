'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Photo = {
  key: string;
  taken_at: string | null;
  created_at: string;
  public_url: string;
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
    <div className="mx-auto w-full max-w-3xl px-6 pb-3 pt-2">
      <div className="mb-2 flex items-center justify-between text-[10px] tracking-wider text-white/40">
        <span className="tabular-nums">{formatShort(minDate)}</span>
        <span className="text-white/60">
          {selectedDate
            ? `筛选：${formatShort(selectedDate)} ± ${Math.round(windowDays / 2)} 天`
            : '拖动滑块筛选'}
        </span>
        <span className="tabular-nums">{formatShort(maxDate)}</span>
      </div>

      <div className="relative">
        {/* Thumbnail popup — floats above the track, anchored to the
            current handle position. Only shown when the user has
            actually scrubbed somewhere (selectedDate set) and at
            least one photo is inside the ±windowDays/2 window. Up
            to 3 thumbs visible, with a "+N" overflow chip if more. */}
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
              <div className="flex gap-1.5 rounded-lg border border-cyan-400/40 bg-black/85 p-1.5 shadow-lg backdrop-blur-sm">
                {visiblePositions.slice(0, 3).map((p) => (
                  <img
                    key={p.key}
                    src={p.publicUrl}
                    alt={p.filename}
                    className="h-12 w-12 rounded object-cover ring-1 ring-white/10"
                    title={p.filename}
                  />
                ))}
                {visiblePositions.length > 3 && (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-black/60 text-xs text-white/70 ring-1 ring-white/10">
                    +{visiblePositions.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Track */}
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          className={`relative h-14 touch-none select-none rounded border bg-white/[0.03] transition ${
            dragging
              ? 'cursor-grabbing border-white/40'
              : 'cursor-pointer border-white/10 hover:border-white/20'
          }`}
        >
          {/* Photo keyframe dots — one per photo, positioned by
              taken_at (fallback created_at) along the track. Cyan
              dot is the same color as the active window overlay so
              it reads as "this is a keyframe inside this scrub
              window" once the user starts scrubbing. pointer-events:
              none so the dots don't break drag. */}
          {photoPositions.map((p) => (
            <div
              key={`dot-${p.key}`}
              className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-cyan-300/80 shadow-[0_0_4px_rgba(103,232,249,0.8)] ring-1 ring-black/40"
              style={{
                left: `${p.pos}%`,
                top: '50%',
                transform: 'translate(-50%, -50%)',
              }}
              title={p.filename}
            />
          ))}

          {/* Selected range overlay */}
          {rangeStart !== null && rangeWidth !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 bg-cyan-400/15"
              style={{
                left: `${rangeStart}%`,
                width: `${rangeWidth}%`,
              }}
            />
          )}

          {/* Selected marker — vertical line + draggable knob */}
          {handlePos !== null && (
            <div
              className="pointer-events-none absolute -top-2 -bottom-2"
              style={{ left: `${handlePos}%`, transform: 'translateX(-50%)' }}
            >
              <div className="h-full w-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(103,232,249,0.7)]" />
              <div className="absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400 bg-black shadow-[0_0_12px_rgba(103,232,249,0.6)]" />
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className="text-white/30">
          {dragging ? '拖动中…' : '点击或拖动轨道选时间'}
        </span>
        {selectedDate && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-cyan-300/70 transition hover:text-cyan-300"
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