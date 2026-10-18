# Phase 5 — Deploy: Delivery Report

**Date:** 2026-10-18 · **Status:** DEPLOY-READY (production not yet live — blocked only on founder credentials, unchanged from Phases 3–4)
**Commits (local, not pushed):** `3c8be6f` deploy config · `5261d57` Mongo integration test · `5c44f0f` runbook

## What was delivered

| # | Deliverable | Result | Evidence |
| --- | --- | --- | --- |
| 5.1 | Complete deploy env config | ✅ | `render.yaml` rewritten with the full env set the code actually reads (JWT_SECRET auto-generated, SMS providers, webhook secret, VAPID, roles, TZ, reminder gate). New `.env.example` documents every key with generation commands. Committed `3c8be6f`. |
| 5.2 | Production boot verification | ✅ | `npm run build` clean (dist 142 KB gz JS + `dist/server.cjs`). Booted the real production bundle with production env: `/health` → 200 `"environment":"production"`, `/` + SPA fallback `/donor` → 200 HTML, `/manifest.webmanifest` + `/sw.js` → 200 with correct MIME, `/api/emergencies` → 200 JSON, helmet headers present (HSTS, nosniff, X-Frame-Options). **Negative test:** booting without JWT_SECRET/FRONTEND_URL refuses to start and lists both problems (fail-fast gate works). |
| 5.3 | MongoDB wiring + Atlas steps | ✅ | Code-inspected `dbService.ts`: real Mongo path (connect on `MONGO_URI`, seed-if-empty, indexes incl. unique phone + OTP TTL, mongodb branch in every CRUD). New **skip-gated integration suite** `backend/__tests__/mongo.integration.test.ts`: skips without `TEST_MONGO_URI`, and on deploy day verifies connect+seed, donor round-trip + unique-index rejection, SOS round-trip + status update — with self-cleanup. Atlas setup steps written into the runbook. Committed `5261d57`. |
| 5.4 | Deployment runbook | ✅ | `DEPLOYMENT-RUNBOOK.md`: hosting decision table (Render $7 recommended; AWS Lightsail $5 Bahrain as the AWS path; free-tier and EC2 pitfalls named), founder checklist with where-and-how for all 9 items, Atlas steps, Render blueprint steps, Lightsail step-by-step (Node 22 + PM2 + Caddy HTTPS), env reference table, SMS webhook config, 10-point post-deploy smoke checklist. Committed `5c44f0f`. |
| 5.5 | Verify + report | ✅ | `npm test` **95/95 passing** (3 skipped = gated Mongo suite), `tsc --noEmit` clean, `vite build` clean. This report. |

## Verification output (real)

```
GET /health            → 200 {"status":"ok","mode":"fallback","environment":"production"}
GET /                  → 200 text/html          GET /donor (SPA)      → 200 text/html
GET /manifest.webmanifest → 200 application/manifest+json
GET /sw.js             → 200 application/javascript
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff   X-Frame-Options: SAMEORIGIN

No JWT_SECRET in production →
  "BloodRadar refused to start — invalid environment configuration:
   - JWT_SECRET is required in production and must be at least 32 characters…
   - FRONTEND_URL is required in production…"

npm test → Test Files 13 passed | 1 skipped (14) · Tests 95 passed | 3 skipped (98)
```

## What still blocks going live (founder decisions — unchanged)

1. MongoDB Atlas connection string (§4 of runbook — founder's 10-minute task)
2. Gemini API key
3. SMS gateway (Twilio or custom-gateway credentials)
4. SMS_WEBHOOK_SECRET delivery to the gateway
5. VAPID keys (generatable in one command)
6. Domain name (optional; onrender.com URL works without one)
7. Contact-reveal policy confirmation
8. Real partner organizations + their phone numbers for ADMIN/STAFF/NGO lists
9. Legal review for emergency health data (Pakistan context)

With those in hand, going live is: push repo (with user's explicit go-ahead — **30 local commits are still unpushed**) → Render Blueprint deploy → run the 10-point smoke checklist. No further code work is required.

## Honest caveats

- The Mongo path is code-inspected and covered by the gated integration test, but has never run against a real Atlas cluster (no credentials exist).
- Graceful-shutdown handlers (SIGINT/SIGTERM → close → 10 s hard-exit) are verified by code inspection only — Windows cannot deliver real POSIX signals to another process; they behave normally on Render's Linux. Included as smoke-checklist item 10.
- Production rate limits engage automatically via `NODE_ENV=production`; the load-test numbers in LOAD-TEST-REPORT.md describe the dev server, not Atlas-backed production. Re-run the load test against the live URL after deploy.
- If the Mongo connection fails at runtime the server falls back to the in-memory store and keeps serving (data lost on restart). The boot log line `db=mongodb` vs `db=fallback` is the check (§9 of runbook).
