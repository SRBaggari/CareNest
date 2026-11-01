import { defineConfig, devices } from "@playwright/test";

// Browser tests: real Chromium against the production build (`npm run build` first), on a fresh
// throwaway database. Setup goes through the public API with the black-box client, which reads
// BLACKBOX_URL — set here so the test workers inherit it.
const PORT = 3100;
const URL = `http://localhost:${PORT}`;
process.env.BLACKBOX_URL = URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // In CI, "github" turns failures into annotations on the run.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: URL, locale: "en-GB", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // The Simple view and the journeys are checked at phone size too.
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: {
    command: `node -e "for (const d of ['.data/e2e','.data/e2e-documents']) require('fs').rmSync(d,{recursive:true,force:true})" && next start -p ${PORT}`,
    url: `${URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PGLITE_DATA_DIR: ".data/e2e", DOCUMENT_STORAGE_DIR: ".data/e2e-documents", INSECURE_COOKIES: "true", TRUST_PROXY: "true" },
  },
});
