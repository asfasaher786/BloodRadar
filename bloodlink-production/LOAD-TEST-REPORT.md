# Phase 4.5 — Load Test Report

**Date:** 2026-10-18 · **Target:** local dev server (`npm run dev`, port 3000, in-memory fallback DB)
**Tool:** autocannon 8.0.0 · **Raw data:** `loadtest/results.json` · **Runner:** `loadtest/run-loadtest.mjs`

## Method

Three scenarios, each run against a **freshly restarted dev server**. A restart is required between
scenarios because every scenario deliberately exhausts a dev rate-limit budget (global
20,000 req/10 min/IP; SOS create 200/10 min/IP), and a polluted limiter would corrupt the next
scenario's numbers. Scenario B additionally sets `Accept: text/event-stream`, which `/api/events`
requires before it switches to the SSE stream.

## Results

### A — Read path: `GET /api/emergencies` (100 connections, 7 s burst)

| Metric | Value |
| --- | --- |
| Requests | 16,330 (all 2xx) |
| Throughput | 2,333.6 req/s |
| Latency avg / p90 / p97.5 / p99 / max | 42.3 / 61.0 / 121 / 171 / 280 ms |
| Errors / timeouts / resets | 0 / 0 / 0 |

Duration is capped at 7 s so the burst stays under the 20k global budget — the latency
percentiles above are therefore clean (no limiter noise mixed in).

**Limiter crossover demo (same endpoint, 15 s, fresh server):** 35,948 requests; the server
served **exactly 20,000 with 2xx** and the remaining **15,949 with 429**. This is the global
rate limiter kicking in precisely at its configured budget — evidence the protection works and
fails closed (see `results.json`, key `A: GET /api/emergencies (15s limiter-crossover demo)`).

### B — SSE hold: `GET /api/events` (30 connections, 8 s, client timeout 2 s)

| Metric | Value |
| --- | --- |
| Requests | 180 sent, all answered **200** (0 non2xx) |
| Stream open latency (headers) | ~28–33 ms |
| Client-side timeouts | 90 (expected by design — SSE streams never close) |
| Resets / refusals | 0 / 0 |

Autocannon counts the client giving up after 2 s as a timeout; for an SSE probe that is the
healthy outcome. The metrics that matter are **0 resets, 0 refusals, 0 non2xx** — the server
accepted all 30 concurrent streams. Independently verified with curl: headers arrived at
~0.21 s with HTTP 200 and the connection stayed open for the full 5 s hold until curl's own
`--max-time` ended it.

### C — Write path: `POST /api/emergencies` (20 connections, 10 s, unique phones)

| Metric | Value |
| --- | --- |
| Requests | 21,655 |
| Created (2xx) | 200 |
| Limited (429) | 21,455 |
| Server errors (5xx) | 0 |
| Write latency avg / p90 / p99 / max | 9.6 / 14.0 / 27.0 / 110 ms |
| Errors / timeouts / resets | 0 / 0 / 0 |

Exactly the intended curve: the dev SOS limiter admits **200 creations per 10 minutes**, then
every further attempt gets 429 while the server stays healthy (health check green after the
storm). No crashes, no 5xx under a sustained write flood.

## Honest caveats

1. **In-memory database.** The dev server runs the fallback store (no MongoDB Atlas). These
   numbers measure the Express route code, validation, and limiter behavior on a single machine —
   **not** production capacity with Atlas, which will add network + index overhead.
2. **One source IP.** Every request came from localhost, so the 429 curves above are per-IP
   budget exhaustion. Real deployments spread load across many client IPs and use the strict
   production limits (global 300, sos 5 per 10 min), which are far tighter.
3. **Dev process.** `npm run dev` wraps the server in tsx/Vite middleware with no clustering.
   Production would run the built JS, optionally behind `node:cluster` and a reverse proxy.

## Conclusion

Under sustained load the server: serves the public board at ~2.3k req/s with sub-50 ms average
latency (fallback DB); holds 30+ concurrent SSE streams with zero resets; sustains a write storm
with no 5xx; and the rate limiters engage exactly at their budgets and fail closed. Phase 4.5
quality gate: **PASS** for the dev environment, with the caveats above carried into the
Phase 4 report.
