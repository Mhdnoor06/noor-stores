// Noor POS service worker — v2 (recovery + network-only).
//
// v1 cached /_next/static and every .js/.css file *cache-first*. After a deploy
// or a dev rebuild the hashed chunk names change, so the worker handed the app a
// STALE chunk whose modules no longer existed — webpack then tried to call an
// undefined module factory and crashed every page on that origin with
// "TypeError: Cannot read properties of undefined (reading 'call')".
//
// This version never caches build assets (so stale chunks are impossible), wipes
// every old cache on activate, and reloads any tab that was stuck on the bad v1
// worker. Offline billing is handled in-app (localStorage outbox), not here.
const CACHE = "noor-pos-v2";

self.addEventListener("install", () => {
  // Take over immediately so a poisoned browser recovers on the next load.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Delete v1's cache (and anything else) — this is what held stale chunks.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Reload tabs that were being controlled by the old worker so they fetch
      // fresh chunks from the network instead of the wiped cache.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        if ("navigate" in client) client.navigate(client.url);
      }
    })(),
  );
});

// A passive fetch handler keeps the app installable (PWA) without ever serving
// cached build assets. Not calling respondWith() lets every request hit the
// network normally, so chunks are always fresh.
self.addEventListener("fetch", () => {});
