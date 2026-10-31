import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { setupTestDb } from "../helpers/db";

describe("GET /api/health", () => {
  const db = setupTestDb();

  it("reports ok when the database answers", async () => {
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", database: "ok" });
  });

  it("has applied the migrations to the test database", async () => {
    const result = await db().execute(
      sql`select count(*)::int as n from information_schema.tables where table_name = 'system_settings'`,
    );
    expect((result as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
  });
});
