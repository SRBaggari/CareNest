import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, inject } from "vitest";
import { createPgPool, schema, setDbForTesting, type Db } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";

type TestDb = { db: Db; close: () => Promise<void> };

/** Embedded Postgres (PGlite), in memory: fast and needs nothing installed. */
async function createPgliteDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzlePglite({ client, schema }) as unknown as Db;
  await runMigrations(db);
  return { db, close: () => client.close() };
}

/** A brand-new database on a real PostgreSQL server (the "postgres" test project). */
async function createPostgresDb(serverUrl: string): Promise<TestDb> {
  const name = `carenest_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: serverUrl, max: 1 });
  // Dropping a test database "with (force)" terminates any connection still open on it; that
  // surfaces as an "error" event, which must not fail the run.
  admin.on("error", () => {});
  await admin.query(`create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const pool = createPgPool(url.toString());
  const db = drizzlePg({ client: pool, schema }) as unknown as Db;
  await runMigrations(db);
  return {
    db,
    close: async () => {
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

/** Creates a fresh, fully migrated database: real PostgreSQL in the "postgres" project, else PGlite. */
export async function createTestDb(): Promise<TestDb> {
  let serverUrl: string | undefined;
  try {
    serverUrl = inject("testDatabaseUrl");
  } catch {
    serverUrl = undefined;
  }
  return serverUrl ? createPostgresDb(serverUrl) : createPgliteDb();
}

/**
 * Registers suite hooks that give the whole test file its own isolated database and make
 * route handlers use it. Returns an accessor because the db is created in `beforeAll`.
 */
export function setupTestDb(): () => Db {
  let current: TestDb | undefined;
  beforeAll(async () => {
    current = await createTestDb();
    setDbForTesting(current.db);
  });
  afterAll(async () => {
    setDbForTesting(undefined);
    await current?.close();
  });
  return () => {
    if (!current) throw new Error("Test database not initialised yet");
    return current.db;
  };
}
