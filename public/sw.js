// CareNest service worker: shows phone alerts and opens the right page when one is tapped, and keeps
// a copy of two kinds of page for reading without a connection: the parent's Simple view and a
// circle's emergency page (card and contacts). Nothing else is kept. Pages always come from the
// network when it works; the copy is used only when it doesn't. Signing out deletes every copy.

const OFFLINE_CACHE = "carenest-offline-v1";
const ASSET_LIMIT = 120;
// Keep in step with src/lib/offline.ts (a unit test checks they match).
const OFFLINE_PAGES = [/^\/simple\/[0-9a-f-]{36}$/, /^\/app\/circles\/[0-9a-f-]{36}\/emergency$/];
const ASSETS = /^\/(_next\/static\/|icon(\/|$)|apple-icon|manifest\.webmanifest$|favicon\.ico$)/;

const isOfflinePage = (pathname) => OFFLINE_PAGES.some((re) => re.test(pathname));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    // Drop caches from older versions of this worker.
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("carenest-offline-") && k !== OFFLINE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && isOfflinePage(url.pathname)) event.respondWith(networkFirst(event, url));
  else if (ASSETS.test(url.pathname)) event.respondWith(assetFromCache(event, request));
});

/** The live page whenever possible (saving a copy as it goes); the saved copy only when offline. */
async function networkFirst(event, url) {
  const cache = await caches.open(OFFLINE_CACHE);
  const key = url.origin + url.pathname;
  try {
    const response = await fetch(event.request);
    if (keepable(response)) event.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch (error) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw error;
  }
}

/** A real page for a signed-in person (not a redirect to sign in, not an error). */
function keepable(response) {
  return response.ok && !response.redirected && (response.headers.get("content-type") || "").includes("text/html");
}

/** Built files never change at the same address, so a saved copy is always right. */
async function assetFromCache(event, request) {
  const cache = await caches.open(OFFLINE_CACHE);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) event.waitUntil(cache.put(request, response.clone()).then(() => trimAssets(cache)));
  return response;
}

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter((r) => ASSETS.test(new URL(r.url).pathname));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map((r) => cache.delete(r)));
}

// A page that registered this worker asks for itself and the files it loaded to be kept, so the
// very first visit can already be read offline.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "keep") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      const page = typeof data.page === "string" ? new URL(data.page, self.location.origin) : null;
      if (page && page.origin === self.location.origin && isOfflinePage(page.pathname)) {
        const response = await fetch(page.href, { credentials: "same-origin" }).catch(() => null);
        if (response && keepable(response)) await cache.put(page.origin + page.pathname, response);
      }
      const assets = (Array.isArray(data.assets) ? data.assets : [])
        .map((u) => new URL(u, self.location.origin))
        .filter((u) => u.origin === self.location.origin && ASSETS.test(u.pathname));
      await Promise.all(assets.map((u) => cache.match(u.href).then((hit) => hit || cache.add(u.href).catch(() => {}))));
      await trimAssets(cache);
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "CareNest";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon/192",
      badge: "/icon/192",
      tag: data.tag || undefined,
      // A newer alert about the same thing replaces the old one but still buzzes.
      renotify: Boolean(data.tag),
      // A request for help stays on screen until someone deals with it.
      requireInteraction: Boolean(data.urgent),
      data: { link: data.link || "/app/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data && event.notification.data.link;
  // Only ever open CareNest's own pages.
  const target = new URL(typeof link === "string" && link.startsWith("/") && !link.startsWith("//") ? link : "/app/notifications", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          w.navigate(target.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
