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
  },
});
