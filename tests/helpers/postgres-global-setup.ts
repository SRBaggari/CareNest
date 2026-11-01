// Starts a real PostgreSQL server for the "postgres" test project (npm run test:postgres), so the
// integration suite also runs on the database used in production, not only embedded PGlite.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

const PORT = Number(process.env.TEST_PG_PORT ?? 54329);

export default async function setup(project: TestProject) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "carenest-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "carenest", password: "carenest", port: PORT, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  project.provide("testDatabaseUrl", `postgres://carenest:carenest@localhost:${PORT}/postgres`);
  return async () => {
    await pg.stop();
    rmSync(dataDir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
