import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "./index";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** Applies all pending SQL migrations in `drizzle/` using whichever driver backs `db`. */
export async function runMigrations(db: Db): Promise<void> {
  const client = (db as unknown as { $client: unknown }).$client;
  if (client instanceof PGlite) {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    await migratePg(db as unknown as NodePgDatabase, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}
