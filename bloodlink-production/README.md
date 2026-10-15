# 🩸 BloodRadar — Emergency Blood Coordination Platform

A platform to help people in Islamabad & Rawalpindi find compatible blood donors faster during emergencies.

**Mission:** No one should lose their life because compatible blood could not be found in time.

## ✨ What's real and working right now
- **Real phone-OTP authentication** — donors verify their number via OTP and get a short-lived access token + 7-day refresh token in httpOnly cookies. No hardcoded users, no client-supplied identity anywhere.
- **Privacy-first contact reveal** — public donor and SOS listings never show a full phone number. A requester raises an SOS anonymously (one-time code), asks the platform to notify matching donors, and only when a donor *accepts* do both sides receive each other's real numbers — with every step written to an admin-only audit trail.
- **Frictionless SOS requests** — only a phone number is required; hospital and patient name are optional, with the system defaulting sensibly if skipped
- **Instant donor matching** — real blood-type compatibility logic, filtered by city and live availability, with a live SSE event stream refreshing the board and donor inboxes in real time
- **Donor phone verification (OTP)** — donors are listed immediately, with an honest "Verified" / "Unverified" badge based on real phone confirmation
- **Real donation logging** — donors self-report completed donations; badges and stats are computed from real logged data, with a genuine 90-day medical eligibility gap enforced and the next eligible date shown to the donor
- **WhatsApp broadcast fallback** — when the platform's own donor pool is thin, a one-tap share button generates a ready-to-forward message, honestly extending reach beyond the app
- **SMS fallback (logic built, not yet connected to a live number)** — the code can parse a plain SMS like "O+ ISLAMABAD" and create a real matching request; wiring this to a real SMS gateway is the one remaining step
- **Real ML Lab** — an urgency classifier that retrains on your actual database of real requests, honestly reporting "not enough real data yet" until there's enough to trust; real donor-location clustering for camp planning, using only real registered donors, no synthetic data
- **Production-grade security & ops** — helmet security headers, strict CORS, rate limits (SOS, OTP, chat), zod validation on every route, sanitized free text, pino structured logging with PII redaction, MongoDB indexes, `/health` with real DB status, graceful shutdown, and a 42-test Vitest+Supertest suite run by GitHub Actions CI
- **Bilingual** — English & اردو throughout

## 🌍 White-label & international deployment

BloodRadar is architected so the same codebase can be licensed or co-operated by clients in other cities or countries. Everything city/country-specific is config, not code:

| What | Where to change it |
| --- | --- |
| Cities/regions served | `backend/config/regions.ts` — `SUPPORTED_CITIES` (one file; donor registration, SOS requests, SMS parsing and the map all read from it) |
| Default country code for local-format numbers | `COUNTRY_CODE` env var (e.g. `971` for UAE). Numbers typed with `+` are always respected as-is |
| SMS provider | `SMS_PROVIDER=console\|twilio\|custom-gateway` env vars — swap Twilio for any gateway with an HTTP API without code changes |
| Branding | `src/App.tsx` header/footer text and `src/assets/logo.png` |
| UI language | English-only build (`lang` state locked to `'en'`); Urdu strings are already wired and can be re-enabled per market |
| Roles (admin/staff/NGO) | `ADMIN_PHONES`, `STAFF_PHONES`, `NGO_PHONES` env lists — OTP-verified numbers only, never hardcoded accounts |

Selling/collaboration notes: this repository is deliberately clean — no client secrets, no environment files, no seed credentials. A client gets the full platform: auth, privacy-compliant contact reveal, live board, analytics, and the test suite + CI that prove it works.

## ⚠️ Known limitations — please read before evaluating
- **Hospital blood-stock numbers shown in the directory are seed/demo data, not live inventory.** No real hospital is currently feeding this platform real stock levels. Treat any "In Stock / Low / Out of Stock" badge as illustrative, not actionable, until a real hospital partnership exists.
- **The donor pool is currently small** (seed data + whoever has registered during testing) — matching quality depends entirely on real donor signups, which this platform doesn't have at scale yet.
- **SMS fallback isn't live** — the parsing logic works, but no SMS number is connected yet.
- Age/health eligibility questions are self-reported checkboxes, not medically verified — appropriate for an MVP, not a substitute for a real donor screening process.

## 🔐 Founder-only decisions (do not invent these — ask)
The platform refuses to boot in production without real configuration, and no credentials may be committed. The founder must supply, before going live:
1. **MongoDB Atlas URI** (or any MongoDB connection string)
2. **SMS gateway account** (Twilio credentials or a custom gateway URL)
3. **Gemini API key** (optional — degrades gracefully without it)
4. **Domain name(s)** for `FRONTEND_URL` / `BACKEND_URL`
5. **Contact-reveal policy confirmation** — current behaviour: requester stays anonymous, donor accepts before numbers are exchanged (first-accept-wins). Confirm this is the intended legal/commercial model for your market.
6. **Legal review** of the privacy policy for your jurisdiction before storing real phone numbers.

## 🚀 Deploy
See `render.yaml` — this project is pre-configured for Render. Push to GitHub, connect the repo on Render, and set the environment variables listed in `render.yaml` (`MONGO_URI`, `GEMINI_API_KEY`, `FRONTEND_URL`, `BACKEND_URL`, `JWT_SECRET`).

## 🧪 For collaborators evaluating this project
See `COLLABORATOR_TESTING_GUIDE.md` for a step-by-step walkthrough of what to test and what feedback would help most. Run the automated test suite with `npm test` (42 tests: auth, OTP limits, rate limits, privacy masking, contact reveal, the 90-day rule, SMS parsing, phone normalization).

## 📋 Phase 1 delivery report
See `PHASE-1-REPORT.md` for the honest, evidence-backed summary of what Phase 1 implemented, verified, and what still needs the founder's input.
