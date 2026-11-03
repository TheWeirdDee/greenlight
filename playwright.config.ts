import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against an already-running app (see README → Testing). Point E2E_BASE_URL at the local
 * stack or at a deployment. `workflow.spec.ts` needs a database and auth provider behind that app.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 600_000,
  expect: { timeout: 45_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "e2e/results/results.json" }]],
  outputDir: "e2e/results/artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3300",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /(mobile|real)\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /(public|mobile)\.spec\.ts/ },
    // Real Supabase / deployed environment: run explicitly with --project=real (see e2e/real.spec.ts).
    { name: "real", use: { ...devices["Desktop Chrome"] }, testMatch: /real\.spec\.ts/ },
  ],
});
