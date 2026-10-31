// Background worker: `npm run worker`. Runs one tick every WORKER_INTERVAL_MS (default 30 s).
// Run exactly one or several — ticks are idempotent and safe to overlap.
import { getDb } from "../src/server/db";
import { runTick } from "../src/server/worker/tick";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function loop() {
  const db = await getDb();
  console.info(`CareNest worker started (every ${INTERVAL_MS / 1000}s).`);
  while (!stopping) {
    const started = Date.now();
    try {
      const summary = await runTick(db, new Date());
      const busy = summary.reminders + summary.unconfirmedAlerts + summary.escalations + summary.refillAlerts + summary.emails.sent + summary.emails.failed;
      if (busy > 0) console.info(new Date().toISOString(), JSON.stringify(summary));
    } catch (err) {
      // Keep running: a transient database error must not stop reminders for good.
      console.error(new Date().toISOString(), "Worker tick failed", err);
    }
    const wait = Math.max(1_000, INTERVAL_MS - (Date.now() - started));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  console.info("CareNest worker stopped.");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

loop().catch((err) => {
  console.error("Worker crashed", err);
  process.exit(1);
});
