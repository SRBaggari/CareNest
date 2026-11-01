import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "./session";
import { assertSameOrigin, clearSessionCookie, getClientIp, readCookie, sessionCookie, SESSION_COOKIE } from "./request";

const req = (headers: Record<string, string>, method = "POST") =>
  new Request("http://localhost:3000/api/v1/x", { method, headers });

describe("readCookie", () => {
  it("finds a cookie among several and decodes it", () => {
    expect(readCookie("a=1; cn_session=abc%3D; b=2", "cn_session")).toBe("abc=");
  });

  it("returns undefined for missing or malformed headers", () => {
    expect(readCookie(null, "x")).toBeUndefined();
    expect(readCookie("garbage", "x")).toBeUndefined();
    expect(readCookie("x=%E0%A4%A", "x")).toBeUndefined();
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax and scoped to the whole site", () => {
    const cookie = sessionCookie("tok", new Date("2030-01-01T00:00:00Z"));
    expect(cookie).toContain(`${SESSION_COOKIE}=tok`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});

describe("session tokens", () => {
  it("are long, random and stored only as a hash", () => {
    const a = generateSessionToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(generateSessionToken());
    expect(hashSessionToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(a)).not.toContain(a);
  });
});

describe("assertSameOrigin", () => {
  it("allows the app's own origin", () => {
    expect(() => assertSameOrigin(req({ origin: "http://localhost:3000" }))).not.toThrow();
  });

  it("rejects a missing or foreign Origin", () => {
    expect(() => assertSameOrigin(req({}))).toThrow(/did not come from CareNest/);
    expect(() => assertSameOrigin(req({ origin: "https://evil.example" }))).toThrow();
  });
});

describe("getClientIp", () => {
  it("F3: ignores X-Forwarded-For unless TRUST_PROXY=true (it is client-controlled)", () => {
    const original = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      expect(getClientIp(req({ "x-forwarded-for": "10.9.8.7" }))).toBe("unknown");
    } finally {
      process.env.TRUST_PROXY = original;
    }
  });

  it("uses the first X-Forwarded-For entry behind a trusted proxy", () => {
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(getClientIp(req({}))).toBe("unknown");
  });
});
