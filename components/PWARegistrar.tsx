'use client';

import { useEffect } from 'react';

/**
 * Registers the production service worker at /sw.js. Returns null; rendering
 * is an empty fragment so it adds nothing to the DOM.
 *
 * Skipped in dev because Next.js dev servers don't serve /sw.js consistently
 * (HMR + cache headers + MIME negotiation cause "no-response" flicker). The
 * service worker is intended for the deployed production build only.
 */
export function PWARegistrar() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Future: handle updates with reg.update() / waiting worker prompt.
          void reg;
        })
        .catch((err) => {
          console.warn('[pwa] sw registration failed', err);
        });
    }
  }, []);
  return null;
}
