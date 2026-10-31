import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll } from "vitest";
import { schema, setDbForTesting, type Db } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";

/** Creates a fresh, fully migrated in-memory Postgres database. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema }) as unknown as Db;
  await runMigrations(db);
  return { db, close: () => client.close() };
}

/**
 * Registers suite hooks that give the whole test file its own isolated database and make
 * route handlers use it. Returns an accessor because the db is created in `beforeAll`.
 */
export function useTestDb(): () => Db {
  let current: { db: Db; close: () => Promise<void> } | undefined;
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
