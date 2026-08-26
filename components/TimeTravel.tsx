'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// Minimal subset of the PhotoRow we need. Defined locally so the
// component doesn't depend on the Supabase schema shape used in
// HomeGallery — keeps the contract narrow (just date fields).
type TravelPhoto = {
  taken_at: string | null;
  created_at: string;
};

type Props = {
  photos: TravelPhoto[];
  open: boolean;
  onClose: () => void;
  // Called (throttled to ~10fps) as currentDate advances during
  // playback. Parent uses this to drive Globe + Timeline via the
  // existing selectedDate state.
  onDateChange: (date: Date) => void;
};

// How fast simulated time advances. Tuned so a 35-year span takes
// ~4 minutes at 1× and ~15 seconds at 8× — long enough to read,
// short enough not to bore.
const SPEED_OPTIONS: Array<{ label: string; daysPerSecond: number }> = [
  { label: '1×', daysPerSecond: 10 },
  { label: '2×', daysPerSecond: 30 },
  { label: '4×', daysPerSecond: 90 },
  { label: '8×', daysPerSecond: 240 },
];

const TICK_MS = 100; // 10 fps state updates; rAF itself runs at 60fps
const DAY_MS = 24 * 3600 * 1000;
const WINDOW_DAYS = 60; // matches TIMELINE_WINDOW_DAYS in HomeGallery

export function TimeTravel({ photos, open, onClose, onDateChange }: Props) {
  // Earliest / latest date across all photos (taken_at preferred).
  // Empty photo list → degenerate single-day range so the UI still
  // mounts without NaN math.
  const { start, end } = useMemo(() => {
    const ts = photos
      .map((p) => new Date(p.taken_at || p.created_at).getTime())
      .filter((t) => Number.isFinite(t));
    if (ts.length === 0) {
      const now = new Date();
      return { start: now, end: now };
    }
    return {
      start: new Date(Math.min(...ts)),
      end: new Date(Math.max(...ts)),
    };
  }, [photos]);

  const [currentDate, setCurrentDate] = useState<Date>(start);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2); // default 4×
  const rafRef = useRef<number | null>(null);

  // Hold the parent's callback in a ref so the animation effect
  // doesn't have to depend on it (every parent re-render would
  // otherwise restart the rAF loop).
  const onDateChangeRef = useRef(onDateChange);
  useEffect(() => {
    onDateChangeRef.current = onDateChange;
  }, [onDateChange]);

  // Reset to earliest photo + auto-play when the modal opens.
  useEffect(() => {
    if (open) {
      setCurrentDate(start);
      setPlaying(true);
    } else {
      setPlaying(false);
    }
  }, [open, start]);

  // ESC to close, Space to toggle play/pause while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Animation: rAF loop advancing currentDate by the configured
  // speed. setState runs at 10fps max to keep React reconciliation
  // cheap (Globe re-renders are not free).
  useEffect(() => {
    if (!playing || !open) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    let lastTick = performance.now();
    const speed = SPEED_OPTIONS[speedIdx];

    const tick = (now: number) => {
      const dt = now - lastTick;
      if (dt >= TICK_MS) {
        lastTick = now;
        const advanceDays = (dt / 1000) * speed.daysPerSecond;
        setCurrentDate((prev) => {
          const nextMs = prev.getTime() + advanceDays * DAY_MS;
          const endMs = end.getTime();
          if (nextMs >= endMs) {
            setPlaying(false);
            onDateChangeRef.current(end);
            return end;
          }
          const next = new Date(nextMs);
          onDateChangeRef.current(next);
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, speedIdx, open, end]);

  // Progress percentage + photo count at current date.
  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = currentDate.getTime() - start.getTime();
  const progress =
    totalMs > 0
      ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))
      : 0;

  const photosAtDate = useMemo(() => {
    const half = (WINDOW_DAYS / 2) * DAY_MS;
    const lo = currentDate.getTime() - half;
    const hi = currentDate.getTime() + half;
    return photos.filter((p) => {
      const t = new Date(p.taken_at || p.created_at).getTime();
      return t >= lo && t <= hi;
    });
  }, [currentDate, photos]);

  const monthSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of photosAtDate) {
      const ts = p.taken_at || p.created_at;
      set.add(ts.slice(0, 7)); // YYYY-MM
    }
    return set;
  }, [photosAtDate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 backdrop-blur-md">
      {/* Header */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">
        <p className="text-xs tracking-[0.4em] text-white/40 uppercase">
          时间旅行 · Time Travel
        </p>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-6 right-6 rounded border border-white/20 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
      >
        ✕ 退出 (ESC)
      </button>

      {/* Center: year + month/day + photo count */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-[12rem] font-extralight leading-none text-white tabular-nums">
            {currentDate.getFullYear()}
          </div>
          <div className="mt-4 text-3xl font-light text-white/50 tabular-nums">
            {currentDate.getMonth() + 1}月
            {String(currentDate.getDate()).padStart(2, '0')}日
          </div>
          <div className="mt-12 text-sm text-white/40 tabular-nums">
            {photosAtDate.length > 0
              ? `${photosAtDate.length} 张照片 · ${monthSet.size} 个月`
              : '该时间窗无照片'}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="absolute bottom-32 left-1/2 -translate-x-1/2 w-[28rem] max-w-[80vw]">
        <div className="h-px bg-white/10">
          <div
            className="h-full bg-cyan-400 transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-white/40 tabular-nums">
          <span>{start.getFullYear()}</span>
          <span className="text-white/60">{progress.toFixed(0)}%</span>
          <span>{end.getFullYear()}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            setCurrentDate(start);
            setPlaying(true);
          }}
          className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10"
          title="重新开始"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="rounded-full bg-white px-6 py-2 text-sm font-medium text-black hover:bg-white/90"
          title={playing ? '暂停 (空格)' : '播放 (空格)'}
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <div className="ml-4 flex gap-1 rounded-full border border-white/20 p-1">
          {SPEED_OPTIONS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setSpeedIdx(i)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                speedIdx === i
                  ? 'bg-white text-black'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}