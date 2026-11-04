import { defineConfig, devices } from "@playwright/test";

// Phase 4 E2E config. The suite runs against the local dev server
// (in-memory fallback DB, console SMS provider that echoes devOtp into
// the UI — that hint must never exist in production). Browsers are the
// three Playwright engines plus a mobile viewport; every test uses unique
// phones so runs are repeatable without server restarts.

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // shared dev server + per-IP limiters: serialize for determinism
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // The app honors prefers-reduced-motion (CSS + MotionConfig). Emulating
    // it makes hit-testing deterministic: html { scroll-behavior: smooth }
    // is disabled under reduce, and WebKit's smooth scrollIntoViewIfNeeded
    // otherwise re-triggers on every click retry and never settles
    // ("element is not stable" — proven via trace screencast pixel diffs:
    // the target oscillated 4px on a ~1s cycle for the full 180s timeout).
    reducedMotion: "reduce",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    // 360px mobile column — the narrowest supported layout.
    { name: "mobile-chromium", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
