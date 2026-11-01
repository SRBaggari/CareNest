import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/** Driver-agnostic database handle used by every service. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

type DbHolder = { db?: Db; ready?: Promise<void> };

// Survive Next.js dev hot reloads without opening a new pool/PGlite per edit.
const holder = ((globalThis as unknown as { __carenestDb?: DbHolder }).__carenestDb ??= {});

/**
 * PostgreSQL connection pool. An idle connection dropping (database restart, network blip) is
 * reported as an "error" event; unhandled, it would crash the web app and the worker. The pool
 * discards that connection and opens a new one on the next query, so logging is enough.
 */
export function createPgPool(url: string): Pool {
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  pool.on("error", (err) => console.error("PostgreSQL connection lost; the pool will reconnect.", err.message));
  return pool;
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzlePg({ client: createPgPool(url), schema }) as unknown as Db;
  }
  // Local development without a Postgres server: embedded Postgres (PGlite) on disk.
  const dataDir = process.env.PGLITE_DATA_DIR ?? ".data/pglite";
  mkdirSync(dataDir, { recursive: true });
  return drizzlePglite({ client: new PGlite(dataDir), schema }) as unknown as Db;
}

/**
 * Returns the shared database. On first use against embedded PGlite the migrations are applied
 * automatically so `npm run dev` works with zero setup; real Postgres is migrated explicitly
 * (`npm run db:migrate`) as part of deployment.
 */
export async function getDb(): Promise<Db> {
  if (!holder.db) {
    holder.db = createDb();
    if (!process.env.DATABASE_URL) {
      const { runMigrations } = await import("./migrate");
      holder.ready = runMigrations(holder.db);
    }
  }
  await holder.ready;
  return holder.db;
}

/** Test hook: route handlers and services resolve this database instead of the default one. */
export function setDbForTesting(db: Db | undefined): void {
  holder.db = db;
  holder.ready = undefined;
}

export { schema };
