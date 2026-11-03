'use client';

import { useEffect, useState } from 'react';
import { t, type Locale } from '@/lib/i18n';

/**
 * Frank #7243 round-6: PWA install prompt.
 *
 * TimeMap ships native iOS/Android apps; LifeFrame is a PWA, and
 * a PWA nobody installs is just a website. Two install paths:
 *
 *   1. Chromium (Chrome / Edge / Samsung Internet): the browser
 *      fires `beforeinstallprompt`, we stash the deferred event and
 *      call `prompt()` from a real user gesture.
 *   2. iOS Safari: **no** `beforeinstallprompt` — the only route is
 *      Share → Add to Home Screen. We detect that case and show the
 *      manual steps instead of staying silent.
 *
 * Placement: a compact pill anchored top-right, below the header.
 * The bottom of the page is already crowded — the timeline, the
 * memory card and the Places panel all live there — so the old
 * bottom banner covered real UI.
 *
 * Dismissal is per-browser (localStorage), not per-account.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const STORAGE_KEY = 'lifeframe-pwa-install-dismissed';

/** iOS Safari (and iPadOS, which reports as Mac with touch). */
function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as desktop Safari
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) return false;
  // Chrome / Firefox on iOS use WebKit but cannot install PWAs.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** Already running as an installed app? */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true
  );
}

const PILL =
  'fixed right-3 top-[248px] z-40 inline-flex min-h-[36px] sm:top-[136px] items-center gap-1.5 rounded-full border border-cyan-500/40 bg-white/90 px-3 text-[11px] text-cyan-700 shadow-sm backdrop-blur-md transition hover:border-cyan-500 dark:border-cyan-400/30 dark:bg-black/80 dark:text-cyan-300/90';
const CARD =
  'fixed right-3 top-[248px] z-40 w-[min(320px,calc(100vw-1.5rem))] sm:top-[136px] rounded-2xl border border-cyan-500/40 bg-white/95 p-4 text-sm shadow-xl backdrop-blur-md dark:border-cyan-400/30 dark:bg-black/90';

export function PWARegistrar({ locale = 'zh' as Locale }: { locale?: Locale } = {}) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  // Start hidden and reveal once the real state is known — avoids a
  // flash of the pill on hydration.
  const [dismissed, setDismissed] = useState<boolean>(true);
  const [installed, setInstalled] = useState<boolean>(false);
  const [ios, setIos] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          void reg;
        })
        .catch((err) => {
          console.warn('[pwa] sw registration failed', err);
        });
    }

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const standalone = isStandalone();
    setIos(isIosSafari());
    setInstalled(standalone);
    setDismissed(stored === 'true' || standalone);

    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setDismissed(false);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
      setDismissed(true);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      // ignore — user choice rejects on some browsers
    }
    setDeferred(null);
    setOpen(false);
  }

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
    setDismissed(true);
    setOpen(false);
  }

  if (typeof window === 'undefined') return null;
  if (installed || dismissed) return null;
  // Nothing to offer: no deferred prompt and not iOS.
  if (!deferred && !ios) return null;

  // ── Collapsed: a small pill ────────────────────────────────────
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t(locale, 'pwa.install')}
        className={PILL}
      >
        📱 {t(locale, 'pwa.install')}
      </button>
    );
  }

  // ── Expanded ───────────────────────────────────────────────────
  return (
    <div role="dialog" aria-label={t(locale, 'pwa.install')} className={CARD}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium text-black dark:text-white">
          📱 {t(locale, 'pwa.install')}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          // The accessible name must contain the visible "✕"
          // (WCAG 2.5.3 Label in Name).
          aria-label={`✕ ${t(locale, 'pwa.close')}`}
          className="-mt-1 -mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm text-black/55 transition hover:bg-black/10 dark:text-white/55 dark:hover:bg-white/15"
        >
          ✕
        </button>
      </div>

      {ios && !deferred ? (
        <>
          <p className="mb-2 text-xs text-black/75 dark:text-white/75">
            {t(locale, 'pwa.iosHint')}
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-black/75 dark:text-white/75">
            <li>{t(locale, 'pwa.iosStep1')}</li>
            <li>{t(locale, 'pwa.iosStep2')}</li>
            <li>{t(locale, 'pwa.iosStep3')}</li>
          </ol>
        </>
      ) : (
        <p className="text-xs text-black/75 dark:text-white/75">
          {t(locale, 'pwa.hint')}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="min-h-[32px] flex-1 rounded-full bg-cyan-500 px-3 text-[11px] font-medium text-white transition hover:bg-cyan-400"
          >
            {t(locale, 'pwa.install')}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="min-h-[32px] flex-1 rounded-full border border-black/15 px-3 text-[11px] text-black/70 transition hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
        >
          {t(locale, 'pwa.notNow')}
        </button>
      </div>
    </div>
  );
}
