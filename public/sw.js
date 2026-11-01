// CareNest service worker: shows phone alerts and opens the right page when one is tapped.
// Deliberately small: no caching yet (offline reading is a later milestone).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
