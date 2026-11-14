'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildScale, MS_PER_DAY } from '@/lib/timeline-scale';

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
  /** Frank #7243 round-3: copies the current view's URL. The
      selected date + search query are encoded in the hash, so the
      copied link reopens exactly this moment. */
  onShare?: () => void;
  /** Result of the last share attempt, for the button's label. */
  shareState?: 'idle' | 'copied' | 'manual';
};

/** Frank #7292: timeline playback speed options. Days per real-
    second at each speed. Default 1× ≈ 365 days/s = one year per
    real-second — a 35-year photo life scrubs through in ~35s.
    Tuned similarly to the TimeTravel modal speeds but exposed on
    the inline timeline so play/pause/speed is always one click
    away (no need to open the modal for casual time-skim). */
const SPEED_OPTIONS: Array<{ label: string; daysPerSecond: number }> = [
  { label: '0.5×', daysPerSecond: 183 },
  { label: '1×', daysPerSecond: 365 },
  { label: '2×', daysPerSecond: 730 },
  { label: '4×', daysPerSecond: 1825 },
];

/**
 * Video-player-style progress bar Timeline.
 *
 * Single thin horizontal line spanning the first photo year → now.
 * Tiny vertical marks on the bar indicate where photos exist
 * (chapter markers). A draggable knob (cyan dot) is the playhead,
 * always visible, with the current date above it. The cyan range
 * overlay is the ±windowDays/2 selection window. Hovering near a
 * photo triggers the thumbnail popup above the bar.
 */
export function Timeline({
  photos,
  selectedDate,
  onChange,
  windowDays,
  onShare,
  shareState = 'idle',
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Frank #7292: hover-tooltip + playback state. Hover is
  // mouse-only (touch/pen drive scrubbing via onPointerDown
  // instead — the tooltip would just flicker during a touch
  // scroll). Playback uses requestAnimationFrame so the
  // date-advance rate is independent of React's render cadence.
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [playing, setPlaying] = useState(false);
  // SPEED_OPTIONS[1] = 1× (the middle "normal" speed).
  const [speedIdx, setSpeedIdx] = useState(1);
  // Active rAF id so the cleanup can cancel the loop correctly.
  const rafRef = useRef<number | null>(null);
  // The track's pixel width — used to thin the year labels so they
  // never collide (Frank #0906 round-15: the old fixed 5-year step
  // overlapped on a phone and left the right-hand years crowded).
  const [trackWidth, setTrackWidth] = useState(0);
  // Mirror selectedDate so the rAF effect reads the current
  // value WITHOUT listing selectedDate in its deps — otherwise
  // every frame's onChange would restart the effect and drop
  // frames. Updated by an effect.
  const selectedDateRef = useRef<Date | null>(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // Right edge = now (recomputed per render — cheap)
  const maxDate = useMemo(() => new Date(), []);
  // The scale: derived from the photos, so the track starts at the
  // first year that actually has a photo and the empty years are
  // compressed.
  const scale = useMemo(() => buildScale(photos, maxDate), [photos, maxDate]);
  const minDate = scale.minDate;

  // Measure the track so the year labels can be thinned to fit.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        if (Number.isNaN(d.getTime())) return null;
        return {
          key: p.key,
          pos: scale.positionFor(d),
          date: d,
          publicUrl: p.public_url,
          thumbnailUrl: p.thumbnail_url,
          filename: p.filename,
        };
      })
      .filter((x): x is PhotoPos => x !== null)
      .sort((a, b) => a.pos - b.pos);
  }, [photos, scale]);

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
    (d: Date) => scale.positionFor(d),
    [scale],
  );

  const dateFromClientX = useCallback(
    (clientX: number): Date | null => {
      if (!trackRef.current) return null;
      const rect = trackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const x = (clientX - rect.left) / rect.width;
      return scale.dateAt(Math.max(0, Math.min(1, x)) * 100);
    },
    [scale],
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

  // Frank #7292: hover-only tooltip source. Mouse-only on purpose
  // — touch / pen events on the bar go through onPointerDown for
  // scrubbing, and the tooltip would just flicker during a touch
  // scroll. Pointer-leave clears it (mouse-off-bar).
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== 'mouse') return;
      const date = dateFromClientX(e.clientX);
      setHoverDate(date);
    },
    [dateFromClientX],
  );
  const handlePointerLeave = useCallback(() => {
    setHoverDate(null);
  }, []);

  // Frank #7292: playback loop. rAF tick advances selectedDate
  // by (elapsedMs × daysPerSecond / 1000) so the rate is
  // independent of the rAF cadence (~60fps). Reaching maxDate
  // pauses automatically so the playhead doesn't fly past the
  // right edge. selectedDate is read via ref so the effect
  // doesn't restart on every date bump.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    let lastTick = performance.now();
    const speed = SPEED_OPTIONS[speedIdx];
    const endMs = maxDate.getTime();
    const tick = (now: number) => {
      const dt = now - lastTick;
      if (dt >= 16) {
        lastTick = now;
        const advanceDays = (dt / 1000) * speed.daysPerSecond;
        const baseMs = (selectedDateRef.current ?? minDate).getTime();
        const nextMs = baseMs + advanceDays * MS_PER_DAY;
        if (nextMs >= endMs) {
          onChange(maxDate);
          setPlaying(false);
          return;
        }
        onChange(new Date(nextMs));
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
  }, [playing, speedIdx, onChange, maxDate, minDate]);

  // Frank #7292: Space toggles play / pause, anywhere on the
  // page. Inputs / textareas / contentEditable nodes opt out so
  // typing " " in a textarea doesn't accidentally pause
  // playback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Year ticks ──────────────────────────────────────────────────
  // Frank #7243 round-3: year marks, borrowed from OldMapsOnline /
  // TimeMap. Clicking a year jumps to it — landing on that year's
  // earliest photo when there is one, so you never jump to an
  // empty year.
  //
  // Frank #0906 round-15: the marks are now the years that ACTUALLY
  // have photos (the old fixed 5-year step printed 1995/2000/… for
  // years with no photos at all, and the right-hand years ended up
  // crowded). They are thinned to the measured pixel width so the
  // labels never overlap.
  const yearTicks = useMemo(() => {
    const yearMap = new Map<number, number>();
    for (const p of photos) {
      const ts = p.taken_at || p.created_at;
      if (!ts) continue;
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      const y = d.getFullYear();
      yearMap.set(y, (yearMap.get(y) ?? 0) + 1);
    }
    return [...yearMap.entries()]
      .map(([year, count]) => ({
        year,
        count,
        pos: scale.positionFor(new Date(year, 0, 1)),
      }))
      .sort((a, b) => a.year - b.year);
  }, [photos, scale]);

  // Thin the ticks to the measured track width.
  const visibleTicks = useMemo(() => {
    if (yearTicks.length === 0) return [];
    if (trackWidth <= 0) return [];
    const minGapPx = 34;
    const out = [yearTicks[0]];
    for (let i = 1; i < yearTicks.length; i++) {
      const last = out[out.length - 1];
      const px = ((yearTicks[i].pos - last.pos) / 100) * trackWidth;
      if (px >= minGapPx) out.push(yearTicks[i]);
    }
    const lastTick = yearTicks[yearTicks.length - 1];
    if (out[out.length - 1] !== lastTick) {
      const prev = out[out.length - 1];
      const px = ((lastTick.pos - prev.pos) / 100) * trackWidth;
      if (px < minGapPx && out.length > 1) out.pop();
      out.push(lastTick);
    }
    return out;
  }, [yearTicks, trackWidth]);

  const jumpToYear = useCallback(
    (year: number) => {
      setPlaying(false);
      const first = photos
        .filter((p) => {
          const ts = p.taken_at || p.created_at;
          if (!ts) return false;
          const d = new Date(ts);
          return !Number.isNaN(d.getTime()) && d.getFullYear() === year;
        })
        .sort(
          (a, b) =>
            new Date(a.taken_at || a.created_at).getTime() -
            new Date(b.taken_at || b.created_at).getTime(),
        )[0];
      onChange(first ? new Date(first.taken_at || first.created_at) : new Date(year, 0, 1));
    },
    [photos, onChange],
  );

  // The share button's visible label; the accessible name is built
  // from it (WCAG 2.5.3 Label in Name).
  const shareLabel =
    shareState === 'copied'
      ? '✓ 已复制'
      : shareState === 'manual'
        ? '📋 请手动复制'
        : '🔗 分享';

  // The playhead is ALWAYS visible: with a selection it sits on
  // that date, otherwise it rests on the newest photo (Frank
  // #0906 round-15: the handle used to be invisible until you
  // dragged something onto the track).
  const handleDate = useMemo(() => {
    if (selectedDate) return selectedDate;
    const newest = photoPositions[photoPositions.length - 1];
    return newest ? newest.date : maxDate;
  }, [selectedDate, photoPositions, maxDate]);
  const handlePos = positionFor(handleDate);

  const rangeStart = useMemo(() => {
    if (!selectedDate) return null;
    const half = (windowDays / 2) * MS_PER_DAY;
    return positionFor(new Date(selectedDate.getTime() - half));
  }, [selectedDate, windowDays, positionFor]);
  const rangeWidth = useMemo(() => {
    if (!selectedDate) return null;
    const half = (windowDays / 2) * MS_PER_DAY;
    const a = positionFor(new Date(selectedDate.getTime() - half));
    const b = positionFor(new Date(selectedDate.getTime() + half));
    return Math.max(0.4, b - a);
  }, [selectedDate, windowDays, positionFor]);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-2 pt-1">
      {/* Compact header — just the date range. No instructions, no
          "筛选：..." copy. The interaction is self-evident once you
          touch the bar. */}
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] tracking-wider text-black/75 dark:text-white/75 tabular-nums">
        <span className="shrink-0">{formatShort(minDate)}</span>
        {selectedDate && (
          <span className="shrink-0 text-cyan-600 dark:text-cyan-300/90">
            {formatShort(selectedDate)} ± {Math.round(windowDays / 2)} 天
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <span>{formatShort(maxDate)}</span>
          {/* Frank #7243 round-3: share the current view. The date
              and the search query live in the URL hash, so the
              copied link reopens this exact moment. */}
          {onShare && (
            <button
              type="button"
              onClick={onShare}
              title="复制当前视图的链接"
              // WCAG 2.5.3 Label in Name: the accessible name must
              // CONTAIN the visible text, otherwise voice-control
              // users saying "click 分享" hit the wrong thing.
              // axe flagged this as
              // label-content-name-mismatch (serious).
              aria-label={`${shareLabel} — 复制当前视图的链接`}
              // z-30 + a solid background: the scrub thumbnail popup
              // floats above the bar at z-20 and would otherwise sit
              // on top of this button.
              className="relative z-30 inline-flex min-h-[28px] items-center gap-1 rounded-full border border-black/25 bg-white/90 px-2 text-[10px] tracking-normal backdrop-blur-sm transition hover:bg-black/5 dark:border-white/25 dark:bg-black/80 dark:hover:bg-white/10"
            >
              {shareLabel}
            </button>
          )}
        </div>
      </div>

      {/* mt-6 leaves room for the playhead's date label, which
          floats above the knob. */}
      <div className="relative mt-6">
        {/* Thumbnail popup — floats above the bar at the playhead's
            position, only when scrubbing near photos. Same UX as
            the previous design. */}
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
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-white/95 dark:bg-black/60 text-xs text-black/75 dark:text-white/80 ring-1 ring-black/10 dark:ring-white/10">
                    +{visiblePositions.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Frank #7292: hover tooltip — shows the date for any
            bar position the mouse is over. Hidden when there's a
            selected date (the existing thumbnail popup carries
            richer context) and while dragging (so the tooltip
            doesn't fight the scrub UX). */}
        {hoverDate &&
          !selectedDate &&
          !dragging && (
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left: `${positionFor(hoverDate)}%`,
                bottom: '100%',
                transform: 'translateX(-50%)',
                marginBottom: '8px',
              }}
            >
              <div className="rounded border border-black/20 bg-white/95 px-2 py-1 text-xs tabular-nums text-black shadow-lg backdrop-blur-sm dark:border-white/25 dark:bg-black/90 dark:text-white">
                {formatShort(hoverDate)}
              </div>
            </div>
          )}

        {/* Bar */}
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          // Frank #7292: hover-only (mouse) tooltip source — touch
          // / pen drive scrubbing via onPointerDown instead.
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
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
          aria-valuenow={selectedDate ? selectedDate.getTime() : handleDate.getTime()}
          aria-valuetext={
            selectedDate ? formatShort(selectedDate) : formatShort(handleDate)
          }
          tabIndex={0}
          className={`relative h-3 touch-none select-none rounded-full bg-black/15 dark:bg-white/15 transition sm:h-1.5 ${
            dragging
              ? 'cursor-grabbing bg-black/20 dark:bg-white/20'
              : 'cursor-pointer hover:bg-black/20 dark:hover:bg-white/20'
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
              className="pointer-events-none absolute h-2 w-0.5 -translate-x-1/2 rounded-sm bg-cyan-500/90 dark:bg-cyan-300/80"
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

          {/* Playhead — a clearly visible cyan knob. pointer-events:
              none so the wrapper's onPointerDown handles the drag
              instead of this element swallowing it. */}
          <div
            className={`pointer-events-none absolute top-[6px] z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500 dark:bg-cyan-400 shadow-[0_0_10px_rgba(8,145,178,0.75)] dark:shadow-[0_0_10px_rgba(103,232,249,0.85)] ring-2 ring-white/70 dark:ring-black/60 transition-transform ${
              dragging ? 'scale-125' : 'scale-100'
            }`}
            style={{ left: `${handlePos}%` }}
          />
        </div>

        {/* The handle's date label — Frank #0906 round-15. It sits
            NEXT TO the knob (never above it, where it collided with
            the hover tooltip and the thumbnail popup) and flips to
            the other side near the right edge so it can never run
            off the track. */}
        <div
          className="pointer-events-none absolute top-[6px] z-20 -translate-y-1/2"
          style={{
            left: `${handlePos}%`,
            transform:
              handlePos > 80
                ? 'translate(calc(-100% - 12px), -50%)'
                : 'translate(12px, -50%)',
          }}
        >
          <span className="whitespace-nowrap rounded-full border border-cyan-400/70 bg-black/90 px-2 py-0.5 text-[10px] leading-none tabular-nums text-cyan-200">
            {formatShort(handleDate)}
          </span>
        </div>

        {/* Year tick row — the years the archive actually has, kept
            apart by the measured track width. */}
        <div className="relative mt-1.5 h-5">
          {visibleTicks.map((t) => {
            // Keep the first and last labels inside the track instead
            // of letting them hang off both ends.
            const align =
              t.pos < 4
                ? 'translate-x-0'
                : t.pos > 96
                  ? '-translate-x-full'
                  : '-translate-x-1/2';
            const isActive =
              selectedDate !== null && selectedDate.getFullYear() === t.year;
            return (
              <button
                key={t.year}
                type="button"
                onClick={() => jumpToYear(t.year)}
                style={{ left: `${t.pos}%` }}
                title={`${t.year} 年 · ${t.count} 张照片`}
                aria-label={`跳到 ${t.year} 年，${t.count} 张照片`}
                className={`group absolute top-0 flex flex-col items-center ${align}`}
              >
                <span
                  className={`block h-2 w-px transition ${
                    isActive
                      ? 'bg-cyan-500 dark:bg-cyan-400'
                      : 'bg-black/40 group-hover:bg-cyan-500 dark:bg-white/50 dark:group-hover:bg-cyan-400'
                  }`}
                />
                <span
                  className={`mt-0.5 block text-[11px] leading-none tabular-nums transition ${
                    isActive
                      ? 'font-medium text-cyan-500 dark:text-cyan-300'
                      : // Frank #0906 round-15: the year labels were
                        // 9 px at 55 % opacity — effectively
                        // invisible on black. Bigger and brighter.
                        'text-black/80 group-hover:text-cyan-600 dark:text-white/80 dark:group-hover:text-cyan-300'
                  }`}
                >
                  {t.year}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Frank #7292: playback control row — video-player style.
          Skip-to-start / play-pause / skip-to-now + speed
          selector with 0.5× / 1× / 2× / 4×. aria-pressed on the
          speed buttons for screen readers. Space toggles
          play / pause from anywhere; the buttons here are for
          mouse / touch. */}
      <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-black/80 dark:text-white/80 sm:gap-2">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(minDate);
          }}
          aria-label="回到起点"
          title="回到起点"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-black/25 px-3 text-base transition hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/5"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? '暂停播放' : '开始播放'}
          title={playing ? '暂停 (空格)' : '播放 (空格)'}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-black px-3 text-sm font-medium text-white transition hover:bg-black/90 sm:px-4 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            onChange(maxDate);
          }}
          aria-label="跳到最新"
          title="跳到最新"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-black/25 px-3 text-base transition hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/5"
        >
          ⏭
        </button>
        <div className="ml-1 flex shrink-0 gap-0.5 rounded-full border border-black/25 p-0.5 dark:border-white/25">
          {SPEED_OPTIONS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setSpeedIdx(i)}
              aria-pressed={speedIdx === i}
              className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full px-2 text-xs transition ${
                speedIdx === i
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'text-black/75 hover:text-black dark:text-white/80 dark:hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
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
            className="text-cyan-600 dark:text-cyan-300/90 transition hover:text-cyan-500 dark:hover:text-cyan-300"
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
