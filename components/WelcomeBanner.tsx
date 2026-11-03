'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { t, type Locale } from '@/lib/i18n';

const STORAGE_KEY = 'lifeframe-welcome-dismissed';

/**
 * Frank #0906 round-13: visitor welcome banner for the home page.
 *
 * P0 #3: the existing OnboardingFlow only fires for signed-in
 * users — a brand-new visitor who lands on the home page never
 * gets any explanation of what LifeFrame is, what it does, or
 * how to get started. This banner is the lighter-weight first
 * touch for the un-authenticated audience.
 *
 * Behavior:
 *   - Mounts in root layout, renders nothing while loading.
 *   - If a Supabase session is detected, defer to OnboardingFlow
 *     (which has the richer 3-step tutorial for signed-in users)
 *     and don't show this banner.
 *   - If no session AND no `lifeframe-welcome-dismissed` flag in
 *     localStorage, show a translucent banner at the top of the
 *     page with one primary CTA (开始记录) and a dismiss button.
 *   - Dismissal is per-browser, not per-account: once a visitor
 *     has seen the intro we don't keep nagging them. This is a
 *     UX tutorial, not a security boundary; localStorage is the
 *     right scope.
 */
export function WelcomeBanner({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let mounted = true;
    (async () => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) === 'true') {
          if (mounted) setLoaded(true);
          return;
        }
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        // Signed-in users get the full 3-step OnboardingFlow; this
        // banner is for un-authenticated visitors only.
        if (!data.session?.user) setOpen(true);
      } catch {
        // If the Supabase env isn't configured, just skip the
        // banner — the rest of the app handles that case.
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (!loaded || !open) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // localStorage disabled (private mode, quota, etc.) —
      // best effort; banner will show again on next mount.
    }
    setOpen(false);
  }

  return (
    <div
      role="region"
      aria-label={t(locale, 'welcome.aria')}
      className="fixed inset-x-0 top-[65px] z-30 flex items-center justify-center gap-2 border-b border-cyan-500/30 bg-white/85 px-4 py-2 text-sm text-black/80 shadow-sm backdrop-blur dark:border-cyan-400/20 dark:bg-black/70 dark:text-white/85 sm:gap-4"
    >
      <span aria-hidden="true" className="text-base">
        🌍
      </span>
      <p className="flex-1 truncate text-center sm:text-left">
        <span className="hidden sm:inline">
          {t(locale, 'welcome.message')}
        </span>
        <span className="sm:hidden">
          {t(locale, 'welcome.messageShort')}
        </span>
      </p>
      {/* Plain <a> (not Next <Link>) — a full page load here is
          intentional: the banner has a dismiss() side effect that
          would need to survive the navigation anyway. */}
      {/* Frank #7243 round-2: this used to be a filled black pill
          — the same weight as the hero's primary CTA, so the
          homepage showed two competing primary buttons saying the
          same thing ("开始记录" on mobile, "开始创建我的
          LifeFrame" on desktop). Demote the banner's action to a
          text link so the hero owns the primary CTA and the
          banner stays a notice. */}
      <a
        href="/login"
        onClick={dismiss}
        className="inline-flex min-h-[36px] flex-shrink-0 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium text-black underline decoration-black/25 underline-offset-4 transition hover:decoration-black/60 dark:text-white dark:decoration-white/25 dark:hover:decoration-white/60 sm:px-3 sm:text-sm"
      >
        {t(locale, 'welcome.cta')}
      </a>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t(locale, 'welcome.dismiss')}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-black/50 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
