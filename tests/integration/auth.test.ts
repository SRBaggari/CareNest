import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as changePassword } from "@/app/api/v1/me/password/route";
import { GET as me, PATCH as patchMe } from "@/app/api/v1/me/route";
import { DELETE as revokeSession } from "@/app/api/v1/me/sessions/[sessionId]/route";
import { GET as listSessions } from "@/app/api/v1/me/sessions/route";
import { hashSessionToken } from "@/server/auth/session";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { sessions, users } from "@/server/db/schema";
import { LOGIN_LIMIT_PER_EMAIL } from "@/server/services/accounts";
import { setupTestDb } from "../helpers/db";
import { apiRequest, params, sessionCookieFrom } from "../helpers/http";
import { signUp, TEST_PASSWORD } from "../helpers/users";

const db = setupTestDb();

describe("POST /api/v1/auth/register", () => {
  it("creates an account, signs the user in and never returns the password hash", async () => {
    const res = await register(
      apiRequest("POST", "/api/v1/auth/register", {
        body: { email: "  Asha@Example.COM ", name: "Asha", password: TEST_PASSWORD, timeZone: "Europe/London" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: "asha@example.com", name: "Asha", timeZone: "Europe/London", locale: "en" });
    expect(JSON.stringify(body)).not.toMatch(/scrypt|passwordHash/);

    const cookie = sessionCookieFrom(res);
    const meRes = await me(apiRequest("GET", "/api/v1/me", { cookie }));
    expect((await meRes.json()).user.email).toBe("asha@example.com");

    const [stored] = await db().select().from(users).where(eq(users.email, "asha@example.com"));
    expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("rejects a duplicate email regardless of case with 409", async () => {
    const user = await signUp();
    const res = await register(
      apiRequest("POST", "/api/v1/auth/register", {
        body: { email: user.email.toUpperCase(), name: "Dup", password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(409);
  });

  it("validates email, password strength and time zone with field errors", async () => {
    const res = await register(
      apiRequest("POST", "/api/v1/auth/register", {
        body: { email: "not-an-email", name: "", password: "short", timeZone: "Mars/Olympus" },
      }),
    );
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(Object.keys(error.details).sort()).toEqual(["email", "name", "password", "timeZone"]);
  });

  it("rejects cross-site requests (CSRF) with 403", async () => {
    const body = { email: "csrf@example.test", name: "X", password: TEST_PASSWORD };
    expect((await register(apiRequest("POST", "/api/v1/auth/register", { body, origin: "https://evil.example" }))).status).toBe(403);
    expect((await register(apiRequest("POST", "/api/v1/auth/register", { body, origin: null }))).status).toBe(403);
  });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: "{",
    });
    expect((await register(req)).status).toBe(400);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("signs in with correct credentials (email is case-insensitive)", async () => {
    const user = await signUp();
    const res = await login(
      apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email.toUpperCase(), password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(200);
    expect(sessionCookieFrom(res)).toBeTruthy();
  });

  it("gives the same generic error for a wrong password and an unknown email", async () => {
    const user = await signUp();
    const wrong = await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: "wrong password!!" } }));
    const unknown = await login(
      apiRequest("POST", "/api/v1/auth/login", { body: { email: "nobody@example.test", password: TEST_PASSWORD } }),
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error.message).toBe((await unknown.json()).error.message);
  });

  it("throttles repeated attempts on one email with 429, even with the right password", async () => {
    const user = await signUp();
    for (let i = 0; i < LOGIN_LIMIT_PER_EMAIL; i++) {
      const res = await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: "wrong password!!" } }));
      expect(res.status).toBe(401);
    }
    const blocked = await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: TEST_PASSWORD } }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refuses disabled accounts", async () => {
    const user = await signUp();
    await db().update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    const res = await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: TEST_PASSWORD } }));
    expect(res.status).toBe(401);
    // Existing sessions stop working too.
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(401);
  });
});

describe("sessions", () => {
  it("rejects requests without a session or with a forged token", async () => {
    expect((await me(apiRequest("GET", "/api/v1/me"))).status).toBe(401);
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: "cn_session=forged" }))).status).toBe(401);
  });

  it("rejects and deletes expired sessions", async () => {
    const user = await signUp();
    const token = user.cookie.split("=")[1];
    await db().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(401);
    expect(await db().select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)))).toHaveLength(0);
  });

  it("logout invalidates the session server-side and clears the cookie", async () => {
    const user = await signUp();
    const res = await logout(apiRequest("POST", "/api/v1/auth/logout", { cookie: user.cookie }));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(401);
  });

  it("lists the user's devices and lets them revoke one, but not someone else's", async () => {
    const user = await signUp();
    const second = sessionCookieFrom(
      await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: TEST_PASSWORD } })),
    );
    const list = await (await listSessions(apiRequest("GET", "/api/v1/me/sessions", { cookie: user.cookie }))).json();
    expect(list.sessions).toHaveLength(2);
    const other = list.sessions.find((s: { current: boolean }) => !s.current);

    const stranger = await signUp();
    const denied = await revokeSession(
      apiRequest("DELETE", `/api/v1/me/sessions/${other.id}`, { cookie: stranger.cookie }),
      params({ sessionId: other.id }),
    );
    expect(denied.status).toBe(404);

    const ok = await revokeSession(
      apiRequest("DELETE", `/api/v1/me/sessions/${other.id}`, { cookie: user.cookie }),
      params({ sessionId: other.id }),
    );
    expect(ok.status).toBe(204);
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: second }))).status).toBe(401);

    const bad = await revokeSession(
      apiRequest("DELETE", "/api/v1/me/sessions/not-a-uuid", { cookie: user.cookie }),
      params({ sessionId: "not-a-uuid" }),
    );
    expect(bad.status).toBe(404);
  });
});

describe("PATCH /api/v1/me", () => {
  it("updates name, language and time zone", async () => {
    const user = await signUp();
    const res = await patchMe(
      apiRequest("PATCH", "/api/v1/me", { cookie: user.cookie, body: { name: "Ravi", locale: "te", timeZone: "Asia/Kolkata" } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ name: "Ravi", locale: "te", timeZone: "Asia/Kolkata" });
  });

  it("rejects unsupported locales, empty updates, and cross-site requests", async () => {
    const user = await signUp();
    expect((await patchMe(apiRequest("PATCH", "/api/v1/me", { cookie: user.cookie, body: { locale: "fr" } }))).status).toBe(422);
    expect((await patchMe(apiRequest("PATCH", "/api/v1/me", { cookie: user.cookie, body: {} }))).status).toBe(422);
    expect(
      (await patchMe(apiRequest("PATCH", "/api/v1/me", { cookie: user.cookie, body: { name: "X" }, origin: "https://evil.example" })))
        .status,
    ).toBe(403);
  });
});

describe("POST /api/v1/me/password", () => {
  it("requires the current password, then signs out other devices but keeps this one", async () => {
    const user = await signUp();
    const otherDevice = sessionCookieFrom(
      await login(apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: TEST_PASSWORD } })),
    );

    const wrong = await changePassword(
      apiRequest("POST", "/api/v1/me/password", {
        cookie: user.cookie,
        body: { currentPassword: "not my password", newPassword: "a brand new passphrase" },
      }),
    );
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).error.details.currentPassword).toBeDefined();

    const ok = await changePassword(
      apiRequest("POST", "/api/v1/me/password", {
        cookie: user.cookie,
        body: { currentPassword: TEST_PASSWORD, newPassword: "a brand new passphrase" },
      }),
    );
    expect(ok.status).toBe(204);
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: user.cookie }))).status).toBe(200);
    expect((await me(apiRequest("GET", "/api/v1/me", { cookie: otherDevice }))).status).toBe(401);

    const relogin = await login(
      apiRequest("POST", "/api/v1/auth/login", { body: { email: user.email, password: "a brand new passphrase" } }),
    );
    expect(relogin.status).toBe(200);
  });
});

describe("consumeRateLimit", () => {
  it("counts within a window and starts a fresh window afterwards", async () => {
    const t0 = new Date("2026-11-01T00:00:00Z");
    const hit = (now: Date) => consumeRateLimit(db(), { key: "test:window", limit: 2, windowMs: 60_000, now });
    expect((await hit(t0)).allowed).toBe(true);
    expect((await hit(new Date(t0.getTime() + 1000))).allowed).toBe(true);
    const third = await hit(new Date(t0.getTime() + 2000));
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSeconds).toBe(58);
    expect((await hit(new Date(t0.getTime() + 61_000))).allowed).toBe(true);
  });

  it("stays correct under concurrent hits", async () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db(), { key: "test:concurrent", limit: 5, windowMs: 60_000, now })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});
