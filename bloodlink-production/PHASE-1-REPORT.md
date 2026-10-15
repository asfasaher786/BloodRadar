# BloodRadar — Phase 1 Delivery Report

**Date:** 2026-10-16 · **Branch:** `main` · **Scope:** backend hardening (auth, security, privacy, real-time, tests) + frontend rewiring to the new contracts.

Everything in this report was either verified by an automated test, by a direct API call, or by clicking through the real UI. Where something could not be verified (because it needs the founder's credentials or real production data), it is listed under *Founder-needed* — nothing there is presented as working.

---

## 1. What Phase 1 delivered

### 1.1 Real authentication (replaces the old fake login)
- Phone OTP login: `POST /api/auth/otp/request` → SMS code; `POST /api/auth/otp/verify` → short-lived JWT access (15 min) + refresh (7 days) in **httpOnly, sameSite=lax, secure-in-prod** cookies (`br_access`, `br_refresh`).
- Roles (`donor | hospital_staff | ngo | admin`) are resolved from OTP-verified phone lists in env config — never from request bodies, never from hardcoded demo tokens in production.
- `/api/auth/me`, `/refresh`, `/logout` work; `/me` returns the donor's own profile (computed 90-day eligibility date included).
- Requesters stay **anonymous forever** — the SOS path has no login wall by design.

### 1.2 OTP abuse protection
- Codes are sha256+salt **hashed at rest**, 5-minute expiry, max **5 attempts**, **60s resend cooldown**, **10/day cap per phone**, per-IP rate limits (`5/10min` request, `10/10min` verify).
- `devOtp` is returned **only outside production** (console SMS provider) and shown in the UI inside a labelled test-mode hint. Production responses never contain the code. Logs redact OTPs and full phone numbers via pino redact paths.

### 1.3 Security hardening
- Zod validation on every route; free text sanitized and length-capped; helmet security headers; strict CORS from `FRONTEND_URL` + local dev origins (credentials on); `express-rate-limit` tiers (global 300/10min, SOS 5/10min, OTP strict, chat 30/5min); 100kb body cap; central error handler returning consistent `{ error }` JSON; fail-fast env validation at boot (production refuses to start without a ≥32-char `JWT_SECRET` and `FRONTEND_URL`).

### 1.4 Privacy-first contact reveal
- `GET /api/donors` and `GET /api/emergencies` **never** return full phone numbers — masked (`+92 300 •••• 234`) with `phoneMasked: true`.
- Anonymous SOS returns a **one-time requester code** (crypto-random, stripped from all public payloads). The requester posts `/api/emergencies/:id/contact-request` with their code → matching donors get inbox items with a **masked** requester number → **first accept wins** (others superseded) → both sides receive the real numbers → every step lands in an admin-only audit trail (`GET /api/admin/audit`, role `admin`).
- `/api/emergencies/:id/reveal?code=` answers `waiting` until someone accepts, then `fulfilled` with the donor's real number — only for the code holder.
- Status changes are privileged: requester may only *cancel* their own SOS (with their code); admins may set any status or delete.

### 1.5 Live updates (SSE)
- `GET /api/events` — PII-free event stream (ids/status only) with `emergency-created`, `emergency-status-changed`, `contact-request-created`, `contact-request-accepted`, `contact-request-declined`. The frontend board, requester panel, and donor inbox all refresh in real time from it.

### 1.6 Eligibility, metrics, data & ops
- 90-day donation gap enforced on `POST /api/donors/log-donation` (second attempt returns 400 with the honest wait message); `nextEligibleDate` computed and shown in the donor card.
- Env-gated 24h donation-reminder job that respects per-donor opt-out.
- MongoDB indexes (unique phone; city+blood+availability; SOS status/createdAt; OTP TTL), seeded data flagged `isSample: true`, median time-to-first-contact metric that is `null` until real data exists (never fabricated).
- `/health` reports real DB mode; graceful shutdown on SIGINT/SIGTERM.

### 1.7 Frontend rewired to the new contracts
- Registration is now OTP-first; the dashboard donor card appears instantly after verification (session-based `/api/auth/me`).
- Availability toggle and donation logging use the **session only** — the old body-supplied phone hole (Phase 0 audit item B4) is gone from both server and client.
- Requester flow: SOS form → live panel (notify matching donors, WhatsApp, cancel) → donor number appears the moment someone accepts.
- New donor inbox component: accept/decline contact requests with live refresh; masked until accepted.
- Public SOS board shows masked contact with an explanatory lock note; anonymous "Fulfill" button removed (it was an authorization hole — status changes are now requester-cancels/admin-only).

---

## 2. Evidence

### Automated tests — 42/42 passing (`npm test`)
| Area | Tests |
| --- | --- |
| Auth (OTP flow, cookies, wrong-code exhaustion, cooldown, refresh/logout, roles) | 7 |
| Rate limits (SOS 429, OTP request 429, OTP verify 429) | 3 |
| SOS creation, masking, zod, wrong-code 403s, cancel authorization | 5 |
| Contact-reveal E2E (notify → masked inbox → accept → mutual reveal → superseded → audit) | 3 |
| Donor rules (masked listings, session-vs-body identity, 90-day rule, reviews, inbox auth) | 6 |
| SMS parsing (field-name variants, city resolution, honest "unclear" reply, 400s) | 4 |
| Health/404/security headers/CORS | 4 |
| Phone normalization incl. `COUNTRY_CODE` configurability | 7 (+ maskPhone) |

### Click-tested in the real browser (dev server, in-memory DB)
- Registered a donor through the UI (OTP box → verify → badge appears with no reload).
- Toggled availability and logged a donation from the badge — stats updated, medal unlocked, "Eligible to donate again from 2027-01-13" displayed (90 days).
- Raised an SOS as a different (anonymous) phone: panel went live, code persisted to localStorage, matching-donor notification worked.
- The donor's inbox appeared instantly via SSE with the masked requester; accepting it revealed the requester's number to the donor **and** the donor's number in the requester panel immediately (SSE, no 15s wait).
- Cancelled the SOS from the requester panel — board updated via SSE to "Cancelled by requester", storage cleared.
- Browser console: no errors.

### API-level checks performed during the build (curl, same dev server)
- Admin OTP login → `role: admin`; admin audit accessible; donor session → 403; anonymous → 401.
- Rate limits observed live (SOS and OTP 429s) — now codified as tests.
- Wrong requester code → 403 on contact-request and reveal.

---

## 3. What is honest, not fabricated
- Donor/hospital/SOS counts come from the real database (or the in-memory fallback in dev). Seed rows are flagged `isSample: true`.
- Median time-to-first-contact is `null` until a real accepted contact request exists.
- The ML lab still honestly reports insufficient real data until it has enough to trust.
- Hospital blood-stock numbers remain seed/demo data (unchanged limitation).

---

## 4. Founder-needed (do not invent — these block going live)
1. **MongoDB Atlas URI** — production currently boots only with a real `MONGO_URI` (in-memory fallback is dev/test only).
2. **SMS gateway account** — `SMS_PROVIDER=twilio` (SID/token/from-number) or `custom-gateway` (URL + optional bearer).
3. **Gemini API key** — optional; the app degrades to rule-based replies without it.
4. **Domain name(s)** — for `FRONTEND_URL`/`BACKEND_URL` (strict CORS + cookie security require them in production).
5. **Contact-reveal policy confirmation** — current model: requester stays anonymous; donors accept before numbers are exchanged; first-accept-wins. Confirm this fits the legal/commercial model of the target market.
6. **Legal review** — privacy policy for storing real phone numbers in the deployment jurisdiction.

---

## 5. Remaining phases (unchanged plan, per the master prompt)
- **Phase 2** — frontend design system pass.
- **Phase 3** — feature completeness against the prompt.
- **Phase 4** — quality gate (full regression, accessibility, performance).
- **Phase 5** — deploy live with the founder's production config from §4.
