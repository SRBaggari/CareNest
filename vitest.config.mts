import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside the React server bundle; tests run server code directly.
  "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty-module.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // The "postgres" project has no tests unless CARENEST_PG_TESTS=true.
    passWithNoTests: true,
    // White-box coverage of everything with logic: services, auth, worker, domain rules,
    // API route handlers and shared libraries. React pages are covered by black-box tests.
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts", "src/i18n/**/*.ts", "src/app/api/**/*.ts", "src/proxy.ts"],
      exclude: ["**/*.test.ts", "src/server/page.ts", "src/server/auth/current-user.ts", "src/i18n/server.ts"],
      reporter: ["text-summary", "json-summary", "json", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          env: { TRUST_PROXY: "true" },
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          // Talks to a running server over HTTP; skipped unless BLACKBOX_URL is set.
          name: "blackbox",
          environment: "node",
          include: ["tests/blackbox/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          // The integration suite again, on a real PostgreSQL server (npm run test:postgres).
          name: "postgres",
          environment: "node",
          include: process.env.CARENEST_PG_TESTS === "true" ? ["tests/integration/**/*.test.ts"] : [],
          globalSetup: ["tests/helpers/postgres-global-setup.ts"],
          env: { TRUST_PROXY: "true" },
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          env: { TRUST_PROXY: "true" },
          include: ["tests/integration/**/*.test.ts"],
          // Each file gets its own in-memory Postgres; migrations take ~1s on first run.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
