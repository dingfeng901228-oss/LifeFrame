// LifeFrame service worker
// Strategy: network-first for navigations (fresh HTML when online), cache-first
// for static same-origin assets. Skips /api and supabase routes so uploads and
// auth never go through cache. Bumping VERSION invalidates both caches.

// Frank #7129 Task #2 deep-dive: bump VERSION v3 → v4 to force
// cache invalidation. Frank reported the like/comment bug
// persisting after commit c8676ba (which had getUser→getSession
// fixes for the like/likes/comments routes). Hypothesis: his
// browser had cached the OLD JS bundles in runtime-v3 and the
// SW's cache-first strategy kept serving them stale. Bumping
// VERSION makes the activate handler clean out the v3 caches
// and pre-cache the new bundles from this deploy. (Same self-
// doc note: any time JS chunks change content, bump VERSION
// so users don't see stale code after deploys.)
const VERSION = 'v4';
const SHELL_CACHE = `shell-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const PRECACHE_URLS = ['/', '/upload'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API/auth/upload routes — they must always reach the server.
  if (url.pathname.startsWith('/api')) return;

  // Network-first for HTML navigations; falls back to cached index on offline.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(event.request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(event.request, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(event.request);
          return (
            cached ||
            (await caches.match('/')) ||
            new Response('Offline', { status: 503 })
          );
        }
      })(),
    );
    return;
  }

  // Cache-first for static same-origin assets (JS, CSS, fonts, images).
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const fresh = await fetch(event.request);
        if (fresh.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(event.request, fresh.clone());
        }
        return fresh;
      } catch {
        return new Response('', { status: 504 });
      }
    })(),
  );
});
