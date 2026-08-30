'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COOKIE_NAME, LOCALES, t, type Locale } from '@/lib/i18n';

type Props = {
  current: Locale;
};

/**
 * Frank #7309: inline locale pill group (replaces the dropdown
 * from B7 commit 2aa861a).
 *
 * Frank called out two issues with the <select>-based version:
 *   - the option list is hidden behind the dropdown caret;
 *     users don't realize a language toggle exists at all
 *     until they interact
 *   - dark-mode contrast was poor on the transparent <select>
 *     + native option-list rendering (Frank #7309: "深色页
 *     面下，易读性太差")
 *
 * Replaced with an inline segmented control: both languages
 * always visible, active one filled (bg-black/white) + bold
 * text, inactive one outlined (transparent bg + subdued text +
 * hover bg). aria-pressed on each button so screen readers
 * announce the selected state. Wrapper has role="group" +
 * aria-label so the cluster has a discoverable name (otherwise
 * AT would just read two button labels with no relationship).
 *
 * Cookie + router.refresh() write-path is unchanged from the
 * dropdown version — only the UI markup changed.
 */
export function LanguageSwitcher({ current }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function setLocale(next: Locale) {
    if (next === current) return;
    // 1y cookie. SameSite=Lax covers top-level navigations; for
    // our use case we never embed the iframe so Strict would be
    // overkill. Path=/ so every route sees the cookie.
    document.cookie = `${COOKIE_NAME}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t(current, 'language.switcherLabel')}
      // Container is a soft pill on both themes: white on light,
      // semi-transparent black on dark. The active button inside
      // inverts the colors for unambiguous "currently selected"
      // state — bg-black text-white on light, bg-white text-black
      // on dark. Both combos are AAA-contrast on their bg.
      className="inline-flex items-center rounded-full border border-black/15 bg-white/95 p-0.5 dark:border-white/20 dark:bg-black/40"
    >
      {LOCALES.map((l) => {
        const active = l.code === current;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLocale(l.code)}
            disabled={pending}
            aria-pressed={active}
            className={`min-h-[28px] rounded-full px-3 py-0.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'text-black/65 hover:bg-black/5 hover:text-black dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white'
            }`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
