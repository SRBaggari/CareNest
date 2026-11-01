import { describe, expect, it } from "vitest";
import { GET as viewRoute } from "@/app/view/route";

const view = (query: string) => viewRoute(new Request(`http://localhost/view?${query}`));

describe("GET /view (Simple / full switch)", () => {
  it("remembers the choice for a year on this device and goes to the requested page", async () => {
    const res = await view(`mode=full&next=${encodeURIComponent("/app/circles/abc")}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app/circles/abc");
    expect(res.headers.get("set-cookie")).toMatch(/^cn_view=full; Path=\/; Max-Age=31536000; SameSite=Lax/);
  });

  it("defaults to the Simple view", async () => {
    expect((await view("next=/simple/abc")).headers.get("set-cookie")).toContain("cn_view=simple");
    expect((await view("mode=nonsense")).headers.get("set-cookie")).toContain("cn_view=simple");
  });

  it("never redirects off-site", async () => {
    for (const next of ["https://evil.example", "//evil.example", String.raw`/\evil.example`]) {
      expect((await view(`mode=full&next=${encodeURIComponent(next)}`)).headers.get("location")).toBe("/app");
    }
  });
});
