'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'lifeframe-theme';

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // localStorage may be blocked (private mode etc.); fall through.
  }
  return 'system';
}

function resolveEffective(t: Theme): 'light' | 'dark' {
  if (t === 'system') {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  return t;
}

function applyToDocument(eff: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (eff === 'light') {
    root.classList.add('light');
    root.classList.remove('dark');
  } else {
    root.classList.add('dark');
    root.classList.remove('light');
  }
}

/**
 * Three-way theme toggle: Light / Dark / System.
 * - "System" follows `prefers-color-scheme` and live-updates when the
 *   OS theme changes mid-session.
 * - "Light" / "Dark" write the choice to localStorage so it persists
 *   across reloads.
 * - The actual flip is done by adding/removing the `.dark` (or
 *   `.light`) class on <html>; globals.css and Tailwind's
 *   `@custom-variant dark (&:where(.dark, .dark *))` do the rest.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [effective, setEffective] = useState<'light' | 'dark'>('dark');

  // Read once on mount (the inline script in layout.tsx has already
  // applied the right class to <html> so there's no FOUC).
  useEffect(() => {
    const t = readStoredTheme();
    setTheme(t);
    setEffective(resolveEffective(t));
  }, []);

  // When the user has "system" selected, react to OS theme changes
  // without waiting for a page reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      if (readStoredTheme() === 'system') {
        const next = resolveEffective('system');
        setEffective(next);
        applyToDocument(next);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const pick = (t: Theme) => {
    setTheme(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
    const eff = resolveEffective(t);
    setEffective(eff);
    applyToDocument(eff);
  };

  const options: Array<{ value: Theme; emoji: string; label: string }> = [
    { value: 'light', emoji: '☀️', label: '浅色模式' },
    { value: 'system', emoji: '💻', label: '跟随系统' },
    { value: 'dark', emoji: '🌙', label: '深色模式' },
  ];

  return (
    <div
      role="group"
      aria-label="主题切换"
      className="flex items-center gap-0.5 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-0.5 text-xs"
    >
      {options.map((o) => {
        const isSelected = theme === o.value;
        // Highlight the effective theme too — for "system" we always
        // mark it selected when its resolved effective matches, which
        // is when system == current color.
        const showSelected = isSelected;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            aria-label={o.label}
            aria-pressed={showSelected}
            title={o.label}
            className={`rounded-full px-2 py-1 transition ${
              showSelected
                ? 'bg-[var(--text-primary)] text-[var(--bg-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span aria-hidden="true">{o.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}
