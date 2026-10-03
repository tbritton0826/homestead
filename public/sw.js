const HOMESTEAD_SW_VERSION = "homestead-pwa-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET") return;

  // Never cache API responses or media files. Homestead library/media state should stay fresh.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;

  // Network-first for the app shell/assets so updates appear after refresh.
  event.respondWith(
    fetch(request)
      .then((response) => response)
      .catch(() => caches.match(request))
  );
});
