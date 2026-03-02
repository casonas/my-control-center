// MCC Service Worker — offline shell + cache-first for assets
const CACHE = "mcc-v1";
const SHELL = ["/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Skip API and SSE requests — always go to network
  if (url.pathname.startsWith("/api")) return;
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
