import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, handle, parseBody } from "./http";

describe("handle", () => {
  it("passes through successful responses", async () => {
    const res = await handle(async () => Response.json({ ok: true }));
    expect(res.status).toBe(200);
  });

  it("maps AppError to its status and a JSON error body", async () => {
    const res = await handle(async () => {
      throw new AppError("not_found", "Care circle not found.");
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Care circle not found." } });
  });

  it("maps validation errors to 422 with field details", async () => {
    const res = await handle(async () => {
      z.object({ email: z.email() }).parse({ email: "nope" });
      return Response.json({});
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.email).toBeDefined();
  });

  it("hides internal error details from clients", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const res = await handle(async () => {
        throw new Error("connection string postgres://secret@host");
      });
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toContain("secret");
    } finally {
      console.error = original;
    }
  });
});

describe("parseBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("rejects malformed JSON with 400", async () => {
    const req = new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    await expect(parseBody(req, schema)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("returns parsed data", async () => {
    const req = new Request("http://x", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify({ name: "Asha" }) });
    await expect(parseBody(req, schema)).resolves.toEqual({ name: "Asha" });
  });

  it("refuses non-JSON content types with 415 (black-box finding F6)", async () => {
    const req = new Request("http://x", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ name: "Asha" }) });
    await expect(parseBody(req, schema)).rejects.toMatchObject({ code: "unsupported_media_type", status: 415 });
  });

  it("adds Retry-After to rate-limit responses", async () => {
    const res = await handle(async () => {
      throw new AppError("rate_limited", "Too many", { retryAfterSeconds: 90 });
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("90");
  });
});
