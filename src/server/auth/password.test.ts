import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("passwordProblem", () => {
  it("accepts a reasonable passphrase", () => {
    expect(passwordProblem("my mother's garden 1962")).toBeNull();
  });

  it("rejects short, overly long, common, and email-equal passwords", () => {
    expect(passwordProblem("short")).toMatch(/at least 10/);
    expect(passwordProblem("x".repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem("Password123")).toMatch(/too common/);
    expect(passwordProblem("asha@example.com", "Asha@Example.com")).toMatch(/not be your email/);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips and uses a fresh salt each time", async () => {
    const a = await hashPassword("a long enough secret");
    const b = await hashPassword("a long enough secret");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("a long enough secret", a)).toBe(true);
    expect(await verifyPassword("a long enough secreT", a)).toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("anything at all", "")).toBe(false);
    expect(await verifyPassword("anything at all", "bcrypt$foo")).toBe(false);
  });
});
