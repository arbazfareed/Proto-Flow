import { defineConfig, devices } from "playwright/test";

// B44: editor interactions with many widgets. Measured against the development server on purpose: React's
// development build makes every element it creates costly, so any work that grows with the number of
// widgets on each interaction shows up many times larger there (the bug was 4.5x slower in dev), while a
// production build hides most of it. Kept apart from the normal browser suite because it measures time.
export default defineConfig({
  testDir: "./e2e/performance",
  testMatch: "**/*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  outputDir: "test-results/performance",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:1421", trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1421 --strictPort",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
