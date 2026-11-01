import { afterEach, describe, expect, it, vi } from "vitest";

// White-box: these branches only run in production, so load the module under a production env.
async function loadProduction(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return import("./request");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("production cookie hardening", () => {
  it("uses the __Host- prefix and the Secure flag", async () => {
    const m = await loadProduction({ INSECURE_COOKIES: undefined });
    expect(m.SESSION_COOKIE).toBe("__Host-cn_session");
    const cookie = m.sessionCookie("tok", new Date("2030-01-01T00:00:00Z"));
    expect(cookie).toContain("Secure");
    expect(cookie.startsWith("__Host-cn_session=tok")).toBe(true);
    expect(cookie).not.toMatch(/Domain=/);
    expect(m.clearSessionCookie()).toContain("Secure");
  });

  it("can be relaxed explicitly for local HTTP testing only", async () => {
    const m = await loadProduction({ INSECURE_COOKIES: "true" });
    expect(m.SESSION_COOKIE).toBe("cn_session");
    expect(m.sessionCookie("tok", new Date())).not.toContain("Secure");
  });
});

describe("origins behind a proxy", () => {
  it("accepts the configured public APP_URL origin as well as the request's own", async () => {
    const m = await loadProduction({ APP_URL: "https://care.example.org" });
    const viaProxy = new Request("http://10.0.0.5:3000/api/v1/x", { method: "POST", headers: { origin: "https://care.example.org" } });
    expect(() => m.assertSameOrigin(viaProxy)).not.toThrow();
    expect(m.appOrigin(viaProxy)).toBe("https://care.example.org");
    const evil = new Request("http://10.0.0.5:3000/api/v1/x", { method: "POST", headers: { origin: "https://care.example.org.evil.test" } });
    expect(() => m.assertSameOrigin(evil)).toThrow();
  });

  it("treats an empty X-Forwarded-For as unknown", async () => {
    const m = await loadProduction({});
    expect(m.getClientIp(new Request("http://x", { headers: { "x-forwarded-for": " , 1.2.3.4" } }))).toBe("unknown");
  });
});
