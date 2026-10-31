import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/server/db";

/** Liveness + database readiness probe for load balancers and uptime checks. */
export async function GET() {
  // Must run per request, never at build time.
  await connection();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", database: "ok" });
  } catch (err) {
    console.error("Health check failed", err);
    return Response.json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}
