// Applies database migrations: `npm run db:migrate` (uses DATABASE_URL, or local PGlite when unset).
import { getDb } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrate";

async function main() {
  const db = await getDb();
  await runMigrations(db);
  console.log("Migrations applied.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
