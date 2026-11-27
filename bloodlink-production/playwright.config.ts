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
    // WebKit in dev-mode averages 4-7s per interaction; several journeys
    // legitimately pass the 60s global budget (observed 56-59s passes and
    // 60s timeouts on the same tests across runs). 2 minutes gives those
    // journeys headroom without slowing anything down — tests still finish
    // as fast as they can; the timeout only caps pathological hangs.
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      timeout: 120_000,
      // Same story for expect() polls: on a cold webkit browser context the
      // app (and the React.lazy FAB chunk) mounts past the 10s default
      // expect window under load — observed "Received: hidden" /
      // "element(s) not found" flakes that never reproduce on an isolated
      // warm load. 30s keeps polls honest without capping genuinely slow
      // webkit mounts.
      expect: { timeout: 30_000 },
    },
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
