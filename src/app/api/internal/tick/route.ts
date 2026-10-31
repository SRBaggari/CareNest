import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { AppError, handle } from "@/server/http";
import { runTick } from "@/server/worker/tick";

/**
 * Runs one worker tick, for hosts that use a scheduler (cron) instead of `npm run worker`.
 * Disabled (404) unless CRON_SECRET is set; requires `Authorization: Bearer <CRON_SECRET>`.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw new AppError("not_found", "Not found.");
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError("unauthenticated", "Invalid credentials.");
    }
    return Response.json(await runTick(await getDb(), new Date()));
  });
}
