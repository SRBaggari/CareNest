// Offline reading: which pages the service worker (public/sw.js) may keep a copy of, and wiping
// those copies. The page list is duplicated in sw.js (plain JS); a unit test keeps them in step.

export const OFFLINE_CACHE = "carenest-offline-v1";

/** The parent's Simple view and a circle's emergency page (card and contacts). Nothing else. */
export const OFFLINE_PAGE_PATTERNS = [/^\/simple\/[0-9a-f-]{36}$/, /^\/app\/circles\/[0-9a-f-]{36}\/emergency$/];

export function isOfflinePage(pathname: string): boolean {
  return OFFLINE_PAGE_PATTERNS.some((re) => re.test(pathname));
}

/** Deletes every saved page and file (on sign-out, so the next person on a shared phone sees nothing). */
export async function clearOfflineCopies(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(OFFLINE_CACHE);
  } catch {
    // Storage blocked or unavailable: there is nothing saved to delete.
  }
}
