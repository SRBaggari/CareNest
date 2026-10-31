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
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // Each file gets its own in-memory Postgres; migrations take ~1s on first run.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
