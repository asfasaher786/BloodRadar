# BloodRadar — Security Review (Phase 4.4)

Date: 2026-10-17 · Scope: backend + frontend of `bloodlink-production`, dev and
production configuration paths. Every claim below cites either a unit test, a
code path, or a tool result — nothing is asserted without evidence.

## 1. Dependency audit

`npm audit` (npm 12): **0 vulnerabilities** across the full tree (prod + dev).

How it got there: express ^4.22.3, vite ^6.4.4, tsx ^4.23.15 were bumped and a
transitive `overrides` block pins patched versions of body-parser, qs,
proxy-addr, protobufjs, browserslist, baseline-browser-mapping, postcss,
nanoid, source-map-js, and esbuild-via-tsx. The override list lives in
`package.json` so future installs stay clean.

## 2. OWASP Top 10 (2021) checklist

| # | Risk | Status | Evidence |
|---|------|--------|----------|
| A01 | Broken Access Control | Handled | Role checks on admin routes (`backend/__tests__/auth.test.ts` "grants admin to the configured admin phone and none to ordinary donors"); audit trail gated 401/403 (`emergencies.test.ts`); requester credentials are one-time codes (`emergencies.test.ts` "rejects contact-request and reveal with a wrong requester code") |
| A02 | Cryptographic Failures | Handled | No password storage exists — auth is phone-OTP + JWT access/refresh in httpOnly cookies (`auth.test.ts`); OTPs are 6-digit, 5-minute expiry, 5-attempt exhaustion (`auth.test.ts`) |
| A03 | Injection | Handled | Zod schemas type-check every route input; NoSQL operator payloads rejected 400 (`emergencies.test.ts` "rejects NoSQL operator payloads with 400"); XSS: no `dangerouslySetInnerHTML`/`innerHTML` anywhere in `src/` — React escaping covers all user text |
| A04 | Insecure Design | Handled | Contact reveal only via explicit accept flow (first-accept-wins, audit-logged); rate-limit tiers on SOS/OTP/verify (`rateLimits.test.ts`) |
| A05 | Security Misconfiguration | Handled | Helmet headers on (CSP deferred to static layer — see §7); `x-powered-by` disabled; 100 kB JSON body cap; strict CORS allow-list with credentials |
| A06 | Vulnerable Components | Handled | `npm audit` 0 findings (§1) |
| A07 | Identification & Auth Failures | Handled | OTP cooldown 60 s, verify-attempt cap, refresh-rotation + logout (`auth.test.ts`) |
| A08 | Software & Data Integrity | Handled | Pinned semver ranges + overrides; no runtime CDN dependencies |
| A09 | Logging & Monitoring | Handled | pino structured logs with PII redaction (`app.ts` httpLogger); audit trail for contact reveals, org approvals, admin actions |
| A10 | SSRF | n/a (no server-side URL fetch) | The only outbound calls are to the SMS provider and (optionally) Gemini, both fixed URLs from env config |

## 3. Auth-bypass evidence (attempted, blocked)

From `backend/__tests__/auth.test.ts` and `emergencies.test.ts`:

- `GET /api/auth/me` without a session → **401**.
- Wrong OTP code → rejected; after 5 attempts the code is exhausted.
- OTP resend for the same phone within 60 s → **429**.
- Anonymous contact-request and reveal on an SOS → **403** (requester code required).
- Cancelling / status-changing someone else's SOS → blocked ("lets the requester cancel their own SOS but nobody else").
- Anonymous audit-trail read → **401**; ordinary-donor read → **403**.
- Admin-only endpoints with a donor session → denied (`auth.test.ts` roles).
- SMS webhook without the shared secret header → **401** (`smsWebhookAuth.test.ts`).

## 4. XSS evidence

- Frontend: zero occurrences of `dangerouslySetInnerHTML`, raw `innerHTML =`,
  or `document.write` in `src/`. All user-supplied strings (names, reasons,
  reviews, chat replies) render through React's escaping.
- Chat replies are plain strings rendered as text; the only formatting is CSS.
- Backend stores and re-serves strings verbatim; no HTML is ever assembled
  server-side (JSON API only).
- Helmet sets `X-Content-Type-Options: nosniff`; CSP is not set (see §7).

## 5. NoSQL injection evidence

- All request bodies pass zod schemas that require plain strings, regex-validated
  enumerations, or numbers (`emergencyRoutes.ts`, `orgRoutes.ts`, etc.).
- The only MongoDB operator in the codebase (`$ne` in `dbService.ts:862`) is
  hardcoded by us — operators are never spread from user input into filters.
- New regression test: `emergencies.test.ts` "rejects NoSQL operator payloads
  with 400" posts `{"$ne": null}` and `{"$gt": ""}` as field values and asserts
  both are rejected. **14/14 tests pass.**
- Belt-and-braces: the fallback in-memory DB has no query language at all, and
  MongoDB is only connected when a valid Atlas URI is configured.

## 6. Secrets handling

- No secrets in the repo: config reads env vars only (`backend/config/config.ts`).
- The dev SMS provider is console-only; the dev OTP hint ("Test mode — your
  code…") is a UI convenience that cannot exist in production because the
  production SMS provider never returns `devOtp`.
- `.gitignore` covers `.env*`, test artifacts (`test-results/`, `playwright-report/`).
- Remaining founder-owned secrets (to be supplied before deployment, never
  committed): MongoDB Atlas URI, SMS gateway credentials, Gemini API key.

## 7. Residual risks & recommendations (honest)

1. **CSP not yet enabled.** Helmet runs with `contentSecurityPolicy: false`
   because the Vite/static layer owns inline assets. XSS risk is mitigated by
   React escaping (§4), but a production CSP with nonces is the recommended
   hardening step before public launch.
2. **Per-IP rate limits need a proxy-aware audit in prod.** `trust proxy` is
   set and Render passes real IPs; verify the header chain after deployment.
3. **In-memory fallback DB is dev-only.** In production mode, startup without
   a Mongo URI must fail loudly rather than serve from memory — confirm this
   path once the Atlas URI is wired (currently guarded by `getDb()` mode
   checks; re-verify in the deploy phase, Phase 5).
4. **No security headers on static assets?** Verify the Vite build's hosting
   config adds the same header set as the API once the frontend is deployed.

## Verification performed

- `npm audit` → 0 findings (2026-10-17).
- Unit suite: 95/95 tests green (94 prior + the new NoSQL-injection test).
- `tsc --noEmit` clean; `vite build` clean (from the Phase 4.1 pass).
- E2E suite green on 4 browser projects (Phase 4.1/4.3; click-matrix run in
  progress at the time of writing — see `CLICK-MATRIX.md`).
