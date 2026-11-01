import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOfflinePage, OFFLINE_CACHE, OFFLINE_PAGE_PATTERNS } from "./offline";

const id = "0b6f2c1e-3d4a-4b5c-8d9e-0f1a2b3c4d5e";

describe("pages kept for offline reading", () => {
  it("keeps only the parent's Simple view and the emergency page", () => {
    expect(isOfflinePage(`/simple/${id}`)).toBe(true);
    expect(isOfflinePage(`/app/circles/${id}/emergency`)).toBe(true);
  });

  it("never keeps anything else: other circle pages, help requests, accounts, the API", () => {
    for (const path of [
      "/app",
      `/app/circles/${id}`,
      `/app/circles/${id}/medicines`,
      `/app/circles/${id}/emergency/${id}`,
      `/app/circles/${id}/documents`,
      "/app/account",
      `/api/v1/circles/${id}/emergency/info`,
      `/simple/${id}/extra`,
      "/simple/not-an-id",
      "/login",
    ]) {
      expect([path, isOfflinePage(path)]).toEqual([path, false]);
    }
  });

  it("the service worker uses the same list and cache name", () => {
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw).toContain(`const OFFLINE_CACHE = "${OFFLINE_CACHE}";`);
    expect(sw).toContain(`const OFFLINE_PAGES = [${OFFLINE_PAGE_PATTERNS.map(String).join(", ")}];`);
  });
});
