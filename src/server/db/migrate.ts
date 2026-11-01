import path from "node:path";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { Db } from "./index";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * CareNest stores Hindi, Telugu and Tamil text, so the database must be UTF8. A database created
 * with an OS default such as WIN1252 or LATIN1 accepts English and then fails on the first
 * Indian-language name or message, so refuse to migrate it at all.
 */
export function requireUtf8(encoding: string) {
  if (encoding.toUpperCase() !== "UTF8") {
    throw new Error(
      `The database uses the ${encoding} character set, but CareNest needs UTF8 to store Hindi, Telugu and Tamil text. ` +
        "Create the database with ENCODING 'UTF8' (for example: CREATE DATABASE carenest ENCODING 'UTF8' TEMPLATE template0).",
    );
  }
}

/** Applies all pending SQL migrations in `drizzle/` using whichever driver backs `db`. */
export async function runMigrations(db: Db): Promise<void> {
  const client = (db as unknown as { $client: unknown }).$client;
  if (client instanceof PGlite) {
    await migratePglite(db as unknown as PgliteDatabase, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { rows } = await (client as Pool).query<{ encoding: string }>(
      "select pg_encoding_to_char(encoding) as encoding from pg_database where datname = current_database()",
    );
    requireUtf8(rows[0].encoding);
    await migratePg(db as unknown as NodePgDatabase, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}
