'use client';

import { useCallback, useMemo, useRef } from 'react';

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
 * Horizontal date-range timeline for the home page. The user clicks the
 * track to set `selectedDate`; the home page filters globe markers to
 * photos within ±windowDays/2 of that date. Selecting nothing (= null)
 * reverts to "all time".
 */
export function Timeline({
  photos,
  selectedDate,
  onChange,
  windowDays,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);

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

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const t = minDate.getTime() + Math.max(0, Math.min(1, x)) * totalSpan;
      onChange(new Date(t));
    },
    [minDate, totalSpan, onChange],
  );

  const handlePos = selectedDate ? positionFor(selectedDate) : null;
  const halfWindowPct = (windowDays / 2 / (totalSpan / MS_PER_DAY)) * 100;
  const rangeStart = handlePos !== null ? Math.max(0, handlePos - halfWindowPct) : null;
  const rangeWidth = handlePos !== null ? Math.min(100, halfWindowPct * 2) : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6 pt-2">
      <div className="mb-2 flex items-center justify-between text-[10px] tracking-wider text-white/40">
        <span className="tabular-nums">
          {minDate.toISOString().slice(0, 10)}
        </span>
        <span className="text-white/60">
          {selectedDate
            ? `筛选：${formatShort(selectedDate)} ± ${Math.round(windowDays / 2)} 天`
            : '全部时间（点下方选时间筛选地球仪照片）'}
        </span>
        <span className="tabular-nums">
          {maxDate.toISOString().slice(0, 10)}
        </span>
      </div>
      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className="relative h-14 cursor-pointer select-none rounded border border-white/10 bg-white/[0.03] transition hover:border-white/20"
      >
        {/* Year ticks */}
        {ticks
          .filter((t) => t.major)
          .map((t) => (
            <div
              key={`y-${t.label}`}
              className="absolute top-0 bottom-0 border-l border-white/25"
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
              className="absolute top-7 bottom-0 border-l border-white/10"
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
        {/* Selected marker */}
        {handlePos !== null && (
          <div
            className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 bg-cyan-400 shadow-[0_0_10px_rgba(103,232,249,0.7)]"
            style={{ left: `${handlePos}%` }}
          />
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className="text-white/30">
          点击轨道选时间 · 拖拽上下方向调窗口（开发中）
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
