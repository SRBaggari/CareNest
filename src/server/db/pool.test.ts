import { afterEach, describe, expect, it, vi } from "vitest";
import { createPgPool } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("createPgPool", () => {
  it("survives a dropped idle connection instead of crashing the process", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = createPgPool("postgres://user:pass@127.0.0.1:1/none");
    // Without a listener, Node throws on an emitted 'error' event and the process exits.
    expect(() => pool.emit("error", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), undefined as never)).not.toThrow();
    expect(log).toHaveBeenCalledWith("PostgreSQL connection lost; the pool will reconnect.", "read ECONNRESET");
    await pool.end();
  });
});
