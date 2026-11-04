import { defineConfig } from "vitest/config";

// Backend test configuration. Each test file runs in its own worker, so the
// in-memory fallback database and rate-limiters start clean per file.
// NODE_ENV=test is set automatically by Vitest, which puts the app in
// IS_TEST mode (silent logging, dev defaults like the console SMS provider).
export default defineConfig({
  test: {
    environment: "node",
    include: ["backend/__tests__/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // P0-2: dev auth shortcuts are opt-in. Tests exercise them heavily
    // (devOtp hints), so the flag is on for the suite by default; the
    // flag-off behaviour is covered explicitly in devAuthShortcuts.test.ts.
    env: {
      ALLOW_DEV_AUTH_SHORTCUTS: "true",
    },
  },
});
