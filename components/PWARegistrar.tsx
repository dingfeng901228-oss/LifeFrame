'use client';

import { useEffect, useState } from 'react';

/**
 * Frank #0906 round-14 (Batch F): PWA install banner + service
 * worker registration. The browser fires the `beforeinstallprompt`
 * event once the manifest + service worker are registered. We
 * stash the deferred prompt and surface a small dismissable card
 * so first-time PWA-eligible visitors know they can add LifeFrame
 * to their home screen.
 *
 * Dismissal is per-browser (localStorage), not per-account —
 * matches the WelcomeBanner UX and the rest of the "first-time
 * helper" surface.
 */
type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const STORAGE_KEY = 'lifeframe-pwa-install-dismissed';

export function PWARegistrar() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [installed, setInstalled] = useState<boolean>(false);

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
    if (window.localStorage.getItem(STORAGE_KEY) === 'true') {
      setDismissed(true);
    }
    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
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
  }

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  if (typeof window === 'undefined') return null;
  if (installed || dismissed || !deferred) return null;

  return (
    <div
      role="dialog"
      aria-label="安装 LifeFrame"
      className="fixed bottom-4 left-4 right-4 z-40 flex items-center gap-3 rounded-lg border border-cyan-500/40 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur dark:border-cyan-400/30 dark:bg-black/85 sm:left-auto sm:right-4 sm:max-w-sm"
    >
      <span className="flex-1 text-black dark:text-white">
        <strong className="mr-1">📱 安装 LifeFrame</strong>
        <span className="text-black/60 dark:text-white/60">
          添加到主屏幕，离线也能用。
        </span>
      </span>
      <button
        type="button"
        onClick={install}
        className="rounded-full bg-cyan-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-cyan-400"
      >
        安装
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭"
        className="flex h-8 w-8 items-center justify-center rounded-full text-black/50 transition hover:bg-black/5 hover:text-black dark:text-white/50 dark:hover:bg-white/5 dark:hover:text-white"
      >
        ×
      </button>
    </div>
  );
}
