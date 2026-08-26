'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Photo = {
  taken_at: string | null;
  created_at: string;
};

type Props = {
  photos: Photo[];
  selectedDate: Date | null;
  onChange: (d: Date | null) => void;
  windowDays: number;
};

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * Horizontal date-range timeline for the home page. The user can either
 * click anywhere on the track to jump to that date, or click-and-drag
 * the track (or the cyan knob) to scrub through dates continuously.
 * The home page filters globe markers to photos within ±windowDays/2 of
 * the selected date. Selecting nothing (= null) reverts to "all time".
 */
export function Timeline({
  photos,
  selectedDate,
  onChange,
  windowDays,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const { minDate, maxDate } = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    for (const p of photos) {
      const ts = p.taken_at || p.created_at;
      if (!ts) continue;
      const d = new Date(ts);
      if (isNaN(d.getTime())) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    if (!min) {
      const now = new Date();
      min = new Date(now.getFullYear() - 3, 0, 1);
      max = now;
    } else if (!max) {
      max = new Date();
    }
    // Pad the edges so ticks aren't jammed against the boundaries.
    const paddedMin = new Date(min.getTime() - MS_PER_DAY * 14);
    const paddedMax = new Date(max.getTime() + MS_PER_DAY * 14);
    return { minDate: paddedMin, maxDate: paddedMax };
  }, [photos]);

  const totalSpan = maxDate.getTime() - minDate.getTime();

  const ticks = useMemo(() => {
    const out: { date: Date; label: string; major: boolean }[] = [];
    const startYear = minDate.getFullYear();
    const endYear = maxDate.getFullYear();
    for (let y = startYear; y <= endYear; y++) {
      out.push({ date: new Date(y, 0, 1), label: `${y}`, major: true });
    }
    for (let y = startYear; y <= endYear; y++) {
      for (let m = 0; m < 12; m++) {
        const startOfMonth = new Date(y, m, 1);
        if (startOfMonth < minDate || startOfMonth > maxDate) continue;
        out.push({ date: startOfMonth, label: '', major: false });
      }
    }
    return out;
  }, [minDate, maxDate]);

  const positionFor = useCallback(
    (d: Date) =>
      Math.max(
        0,
        Math.min(100, ((d.getTime() - minDate.getTime()) / totalSpan) * 100),
      ),
    [minDate, totalSpan],
  );

  // Convert a clientX coordinate (within the viewport) to a Date based
  // on the track's bounding rect. Returns null if the track isn't
  // mounted yet.
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

  // ── Drag-to-scrub ───────────────────────────────────────────────
  // Same pattern as Globe.tsx: pointerdown on the track starts the
  // drag, window-level listeners keep firing when the pointer leaves
  // the track (especially relevant on touch). We avoid setPointerCapture
  // here too so clicks and drags both work natively.
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only respond to primary mouse button (left click) or touch.
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

  // Cleanup on unmount.
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
        <span className="tabular-nums">
          {minDate.toISOString().slice(0, 10)}
        </span>
        <span className="text-white/60">
          {selectedDate
            ? `筛选：${formatShort(selectedDate)} ± ${Math.round(windowDays / 2)} 天`
            : '拖动滑块筛选地球仪照片'}
        </span>
        <span className="tabular-nums">
          {maxDate.toISOString().slice(0, 10)}
        </span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className={`relative h-14 touch-none select-none rounded border bg-white/[0.03] transition ${
          dragging
            ? 'cursor-grabbing border-white/40'
            : 'cursor-pointer border-white/10 hover:border-white/20'
        }`}
      >
        {/* Year ticks */}
        {ticks
          .filter((t) => t.major)
          .map((t) => (
            <div
              key={`y-${t.label}`}
              className="pointer-events-none absolute top-0 bottom-0 border-l border-white/25"
              style={{ left: `${positionFor(t.date)}%` }}
            >
              <span className="absolute left-1 top-1 text-[10px] tracking-wider text-white/70">
                {t.label}
              </span>
            </div>
          ))}
        {/* Month ticks */}
        {ticks
          .filter((t) => !t.major)
          .map((t, i) => (
            <div
              key={`m-${i}`}
              className="pointer-events-none absolute top-7 bottom-0 border-l border-white/10"
              style={{ left: `${positionFor(t.date)}%` }}
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
        {/* Selected marker — vertical line + draggable knob. The knob
            is a cyan dot that sits on top of the line and gives users
            a clear "grab here" affordance. The whole track is also
            draggable, but the knob makes it discoverable. */}
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