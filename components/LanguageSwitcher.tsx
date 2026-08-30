'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COOKIE_NAME, LOCALES, t, type Locale } from '@/lib/i18n';

type Props = {
  current: Locale;
};

/**
 * Frank #7304: locale switcher.
 *
 * Writes the chosen locale to a long-lived cookie (max-age 1y,
 * SameSite=Lax) and triggers Next.js router.refresh() to re-
 * render server components with the new locale. The cookie is
 * read by lib/i18n-server.ts::getLocale() on every server render,
 * so all t() calls update atomically.
 *
 * Using a <select> (not a button row) keeps the switcher compact
 * for the small viewports documented in Task 4. Options are
 * defined in lib/i18n.ts::LOCALES so adding a third locale
 * later is a single-file change.
 *
 * Pending state via useTransition so the dropdown stays
 * responsive even on slower networks; refresh() in a transition
 * signals intent to Next.js without blocking the UI.
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
    <label className="relative inline-flex items-center">
      <span className="sr-only">{t(current, 'language.switcherLabel')}</span>
      <select
        // Native <select> with aria-label (visually hidden label
        // above provides the text). appearance-none strips the
        // default chevron so the custom ▾ we paint next to it
        // looks consistent across browsers.
        aria-label={t(current, 'language.switcherLabel')}
        value={current}
        onChange={(e) => setLocale(e.target.value as Locale)}
        disabled={pending}
        className="appearance-none cursor-pointer rounded border border-black/15 bg-transparent px-2 py-1 pr-6 text-xs text-[var(--text-secondary)] transition hover:border-black/40 hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 dark:border-white/15 dark:hover:border-white/40"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-black/40 dark:text-white/40"
      >
        ▾
      </span>
    </label>
  );
}
