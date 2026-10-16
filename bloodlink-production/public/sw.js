/* BloodRadar service worker — prod-only (registered from main.tsx when
   import.meta.env.PROD). Honest offline strategy:
   - /api/* is NEVER cached (medical data must always be fresh and private).
   - The app shell is precached so the PWA opens offline.
   - Hashed build assets are served stale-while-revalidate for speed.
   - The offline UI banner says: "call the hospital directly" + hotlines. */

const CACHE_NAME = "bloodradar-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-1024.png",
  "/og-image.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API traffic.
  if (url.pathname.startsWith("/api/") || event.request.method !== "GET") return;

  // Navigations: network-first, fall back to the cached shell when offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/").then((cached) => cached || caches.match("/index.html"))
      )
    );
    return;
  }

  // Same-origin static assets (hashed by the build): stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        });
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (fonts, Leaflet CDN): cache-first with a runtime cache, so
  // the map and typography survive flaky connections; skip opaque failures.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && (response.ok || response.type === "opaque")) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
