"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

const subscribe = (onChange: () => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/**
 * On the pages worth reading without a connection (the Simple view, the emergency page): makes sure
 * the service worker is running, asks it to keep this page and the files it used, and says plainly
 * when what's on screen is a saved copy and from when.
 */
export function OfflineSupport({ renderedAt, locale, label }: { renderedAt: string; locale: string; label: string }) {
  const offline = useSyncExternalStore(subscribe, () => !navigator.onLine, () => false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.onLine) return;
    let cancelled = false;
    (async () => {
      const registration = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
      const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
      if (cancelled || !worker) return;
      const assets = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin));
      worker.postMessage({ type: "keep", page: location.pathname, assets });
    })().catch(() => {
      // No service worker (private window, blocked storage): the page still works online.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!offline) return null;
  const time = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(renderedAt));
  return (
    <p role="status" className="flex items-center gap-3 rounded-2xl border-2 border-warning bg-warning-soft p-4 text-lg font-semibold text-warning">
      <WifiOff aria-hidden="true" className="size-6 shrink-0" />
      {label.replace("{time}", time)}
    </p>
  );
}
