// BloodRadar Phase 4.5 — load test against the LOCAL DEV SERVER (:3000).
//
// IMPORTANT — clean-numbers protocol:
//   * Run ONE scenario per fresh server. Each scenario deliberately exhausts
//     the dev rate-limit budgets (global 20k/10min per IP), so the next
//     scenario would inherit a polluted limiter. Restart the dev server
//     between scenarios.
//   * Usage:  node loadtest/run-loadtest.mjs A | B | C | all
//     (with "all", you are responsible for restarting between scenarios —
//     the script pauses and reminds you.)
//
// Scenarios:
//   A. GET  /api/emergencies   — read path throughput + p90/p99 latency
//   B. GET  /api/events        — SSE hold probe: can the server keep 30
//                                event streams open? (Client-side timeouts
//                                are EXPECTED: SSE never closes a response.)
//   C. POST /api/emergencies   — SOS creation storm with unique phones:
//                                measures write throughput and demonstrates
//                                the 200-per-10-min dev rate limiter (429s).
//
// Honest caveat: the dev server uses an in-memory data store and generous
// dev-only rate limits, so these numbers describe the code paths and the
// limiter behavior — NOT production capacity on MongoDB Atlas.

import autocannon from "autocannon";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const RESULTS_PATH = new URL("./results.json", import.meta.url);

const arg = (process.argv[2] || "all").toLowerCase();
const wanted = arg === "all" ? new Set(["a", "b", "c"]) : new Set([arg]);
const known = ["a", "b", "c"];
if (!known.includes(arg) && arg !== "all") {
  console.error(`Unknown scenario "${process.argv[2]}". Use: A | B | C | all`);
  process.exit(1);
}

// Preserve earlier scenario results instead of clobbering the whole file.
let results = {};
try {
  results = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
} catch {
  results = {};
}

async function run(name, options, expectedNotes) {
  const result = await autocannon({ url: BASE, ...options });
  const summary = {
    requests: result.requests,
    throughput: `${result.requests?.average?.toFixed(1)} req/s`,
    latency: {
      avg: `${result.latency.average.toFixed(1)} ms`,
      p90: `${result.latency.p90.toFixed(1)} ms`,
      p97_5: `${result.latency.p97_5.toFixed(1)} ms`,
      p99: `${result.latency.p99.toFixed(1)} ms`,
      max: `${result.latency.max.toFixed(1)} ms`,
    },
    non2xx: result.non2xx ?? 0,
    errors: result.errors ?? 0,
    timeouts: result.timeouts ?? 0,
    resets: result.resets ?? 0,
  };
  results[name] = { options: { connections: options.connections, duration: options.duration }, ...summary, notes: expectedNotes };
  console.log(`\n=== ${name} ===`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`notes: ${expectedNotes}`);
  return result;
}

const pause = (label) =>
  new Promise((resolve) => {
    console.log(`\n>>> ${label}`);
    console.log(">>> Press Enter when the dev server has been restarted (fresh limiter)...");
    process.stdin.once("data", () => resolve());
  });

if (wanted.has("a")) {
  // A. Read path. Duration is capped at 7s so the run stays UNDER the dev
  // global limiter budget (20,000 req/10min/IP): at ~2.4k req/s, 7s ≈ 17k
  // requests — clean all-2xx latency percentiles. (A 15s run crosses the
  // limiter; that crossover is recorded separately as its own demo.)
  await run(
    "A: GET /api/emergencies (read)",
    { connections: 100, duration: 7, requests: [{ method: "GET", path: "/api/emergencies" }] },
    "Public board read, 7s burst kept under the 20k global budget for clean percentiles. Expect sub-50ms p95 in fallback mode."
  );
  if (arg === "all" && (wanted.has("b") || wanted.has("c"))) await pause("Scenario A done — restart the dev server before scenario B.");
}

if (wanted.has("b")) {
  // B. SSE hold probe. Every connection stays open until the client gives up;
  // timeouts are therefore expected and healthy — the metric that matters is
  // that the server accepts all connections without resets/refusals.
  // The Accept header is required: /api/events only switches to the SSE
  // stream when the client asks for text/event-stream.
  await run(
    "B: GET /api/events (SSE hold)",
    { connections: 30, duration: 8, timeout: 2, requests: [{ method: "GET", path: "/api/events", headers: { accept: "text/event-stream" } }] },
    "EventSource hold. Timeouts expected (SSE never completes); watch for resets/refusals."
  );
  if (arg === "all" && wanted.has("c")) await pause("Scenario B done — restart the dev server before scenario C.");
}

if (wanted.has("c")) {
  // C. SOS creation storm with unique phones (no duplicate-detection skips).
  const sosResult = await run(
    "C: POST /api/emergencies (write + limiter)",
    {
      connections: 20,
      duration: 10,
      initialContext: { counter: 0 },
      requests: [
        {
          method: "POST",
          path: "/api/emergencies",
          headers: { "content-type": "application/json" },
          setupRequest: (req, context) => {
            context.counter += 1;
            return {
              ...req,
              body: JSON.stringify({
                bloodGroup: "O+",
                contactPhone: `+92300${String(4000000 + context.counter)}`,
              }),
            };
          },
        },
      ],
    },
    "Dev sos limiter allows 200 creations per 10 min; the remainder get 429 — this scenario intentionally crosses that line."
  );
  results["C: POST /api/emergencies (write + limiter)"].codeBreakdown = {
    "2xx (created)": sosResult["2xx"],
    "4xx (limited/dupes)": sosResult["4xx"],
    "5xx": sosResult["5xx"],
  };
}

writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
console.log("\nWrote loadtest/results.json");
