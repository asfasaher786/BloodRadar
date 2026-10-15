# BloodRadar — Phase 0 Audit Report

Date: 2026-10-16 · Environment: Windows, Node v24.16.0, npm 12.0.2 · App: `bloodlink-production/` · Mode: development, in-memory data fallback (no MONGO_URI set)

---

## 1. Method & Evidence

- Installed dependencies (`npm install`), ran `npm run lint` (tsc --noEmit) and `npm run build` (vite + esbuild server bundle) — both pass after 3 fixes (see §6).
- Ran the app via `npm run dev` on port 3000 and verified `/health`, `/api/stats`, frontend HTML (200).
- Click-tested every interactive element in the running app through a live browser session (accessibility-tree snapshots + real event dispatch + network request log as evidence). Screenshot capture was unavailable in this session (hidden browser surface); all pass/fail evidence below is from DOM state, network calls, and API responses observed after each interaction.
- Extracted every frontend `fetch()` call and compared it against backend routes; fixed the one mismatch found (§5).

## 2. Build & Run

| Check | Result |
|---|---|
| `npm install` | Pass |
| `npm run lint` (tsc --noEmit) | Fail initially (3 errors) → **Pass after fixes** |
| `npm run build` | Pass (816 kB JS bundle — chunk-size warning only) |
| Server boots, `/health` 200 | Pass |
| Frontend served at `/` | Pass |
| MongoDB | Not configured — in-memory fallback active (as designed) |

## 3. Page & Element Inventory

Single-page app (React SPA, one route). Screens/sections:

1. **Header** — logo, live-SOS count badge, bell button (desktop), mobile menu button (hidden ≥md, opens an **empty** dropdown panel — see bug B12)
2. **Emergency ticker** (conditional) — Dismiss + X buttons
3. **Hero** — stats pills (Donors/Hospitals/Active SOS), anchor links "View Live Emergencies", "Request Blood (SOS)"
4. **Live Blood Map** — Leaflet + OSM tiles, Islamabad/Rawalpindi jump chips, hospital & camp markers with popups, legend
5. **Directory tabs** — Hospitals, Camps, Analytics, Real ML Lab
   - Hospitals: 6 cards (select → map focus + popup)
   - Camps: 3 cards with "Register (n)" buttons
   - Analytics: 4 stat tiles + pie (blood mix) + bar (hospital stock)
   - ML Lab: model status, classifier test box, donor clustering
6. **Emergencies board** — pending count, per-SOS "Call" (tel:) and "Fulfill" buttons
7. **SOS form** — name, phone*, blood group, units, city, urgency, hospital, reason, BROADCAST button, success panel + WhatsApp share
8. **Savior Network & Registry** — Search/Register sub-tabs
   - Search: blood-group chips, city chips, "Active/Available Only" toggle, donor cards (call/copy button, reviews expander + submit form)
   - Register: name*, phone*, blood group, city chips, location*, 3 checkboxes, submit; post-register OTP panel (send → code entry → verify)
9. **Donor Streak card** (appears when a localStorage donor matches the registry) — "I Just Donated Blood", availability toggle
10. **24/7 Hotlines** — 4 tel: links
11. **Footer**
12. **Floating AI chatbot** — open/close, 4 suggestion chips, message input + send, speak button, emergency-alert rendering

## 4. Frontend ↔ Backend Route Table

| # | Frontend call | Backend route | Method/body match | Status |
|---|---|---|---|---|
| 1 | `GET /api/hospitals` | hospitalRoutes `GET /` | ✓ | Pass |
| 2 | `GET /api/camps` | campRoutes `GET /` | ✓ | Pass |
| 3 | `GET /api/donors` | donorRoutes `GET /` | ✓ | Pass |
| 4 | `GET /api/emergencies` | emergencyRoutes `GET /` | ✓ | Pass |
| 5 | `GET /api/notifications` | notificationRoutes `GET /` | ✓ | Pass |
| 6 | `GET /api/stats` | statsRoutes `GET /` | ✓ (shape matches StatsDashboard interface) | Pass |
| 7 | `POST /api/emergencies` | emergencyRoutes `POST /` | ✓ (body incl. optional fields; response `{success, request}` matches `d.request` use) | Pass |
| 8 | `PATCH /api/emergencies/:id/status` | emergencyRoutes `PATCH /:id/status` | ✓ | Pass |
| 9 | `POST /api/camps/register` `{campId}` | campRoutes `POST /register` | ✓ | Pass |
| 10 | `POST /api/notifications/read-all` | notificationRoutes `POST /read-all` | ✓ | Pass |
| 11 | `POST /api/donors/register` | donorRoutes `POST /register` | ✓ | Pass |
| 12 | `POST /api/donors/send-otp` `{phone}` | donorRoutes `POST /send-otp` | ✓ | Pass |
| 13 | `POST /api/donors/verify-otp` `{phone, code}` | donorRoutes `POST /verify-otp` | ✓ | Pass |
| 14 | `POST /api/donors/toggle-availability` `{phone, isAvailable}` | donorRoutes `POST /toggle-availability` | ✓ | Pass |
| 15 | `POST /api/donors/log-donation` `{phone}` | donorRoutes `POST /log-donation` | ✓ | Pass |
| 16 | `POST /api/donors/:id/reviews` `{patientName, rating, comment}` | donorRoutes `POST /:id/reviews` | ✗ **body field mismatch — FIXED** (backend read `reviewerName`; seed data and UI render use `patientName`) | Fixed |
| 17 | `POST /api/chat` `{message, sessionId, language}` | chatRoutes `POST /` | ✓ (response `{reply, history}` matches) | Pass |
| 18 | `GET /api/ml/real-status` | mlRoutes `GET /real-status` | ✓ | Pass |
| 19 | `GET /api/ml/real-donor-clustering?k=3` | mlRoutes `GET /real-donor-clustering` | ✓ | Pass |
| 20 | `POST /api/ml/real-classify-urgency` `{text}` | mlRoutes `POST /real-classify-urgency` | ✓ (both `trained:true/false` shapes match) | Pass |

Backend-only routes not called by frontend (verified working via direct calls): `/api/sms/incoming` (parses `O+ RAWALPINDI` correctly, honest zero-match reply), `/api/auth/login|register|me` (fake — see B1), `/api/ml/classify-chat`.

**Result: 1 mismatch found, 1 fixed. No other route mismatches.**

## 5. Click Matrix (element → expected → actual → pass/fail)

| # | Element | Expected | Actual | Result |
|---|---|---|---|---|
| 1 | SOS form submit (phone only) | Success panel + donor count + board entry | "Request sent. 1 compatible donors nearby…", SOS on board, pending 2→3 | **PASS** |
| 2 | SOS form, empty phone | Blocked with validation | Native `required` validation blocks (input `:invalid`, no POST) | **PASS** |
| 3 | WhatsApp share link (after SOS) | wa.me URL with encoded message | Correctly encoded URL incl. phone | **PASS** |
| 4 | Emergency "Fulfill" | Status → Fulfilled, pending count -1 | Card → "Fulfilled · Lives Saved", 3→2 | **PASS** |
| 5 | Emergency "Call" link | tel: href | `tel:+92…` links present | **PASS** |
| 6 | Ticker "Dismiss" | POST read-all + ticker hides | POST 200, all notifications read:true, ticker visually hidden (opacity 0 / height 0). Residual DOM node lingers (minor, B13) | **PASS*** |
| 7 | Donor blood filter chips | Filter list | AB- → empty state; O- → only Zainab Malik | **PASS** |
| 8 | Donor city filter | Filter list | Rawalpindi → 3 Rawalpindi donors | **PASS** |
| 9 | "Active / Available Only" toggle | Hide busy donors | 7→6 (Bilal "Busy" hidden) | **PASS** |
| 10 | Donor "Call" button | Copy + "Copied!" feedback | Label switches to "Copied!" | **PASS** |
| 11 | Reviews expander + submit | Review posted, name rendered | "Review successfully posted", patient name shown (fix verified) | **PASS** |
| 12 | Register tab, empty submit | Blocked | Native required validation blocks (3 required fields) | **PASS** |
| 13 | Register submit (valid) | Success + localStorage + streak card | Success msg, phone in localStorage, streak card appears | **PASS** |
| 14 | OTP send | Code sent, dev hint shown | Hint "Test mode — your code: 620421" (dev only — correct per config) | **PASS** |
| 15 | OTP verify | Verified state | "Phone verified — you now have the trusted badge" | **PASS** |
| 16 | Availability toggle | AVAILABLE ↔ OFFLINE | Toggled, API persisted | **PASS** |
| 17 | "I Just Donated Blood" | Log donation | "Recorded — thank you…" (first donation) | **PASS** |
| 18 | Log donation again immediately | 90-day rejection | "…next donation in about 90 days…" | **PASS** |
| 19 | Camp "Register (n)" | Count increments | 48 → 49 | **PASS** |
| 20 | Analytics tab | Tiles + 2 charts | Totals 8/2/1/3, pie + bar render | **PASS** |
| 21 | ML Lab status | Honest status | "Not enough real data yet" (3/15 examples) | **PASS** |
| 22 | ML classify (test box) | Refuse until trained | "Not enough real data to classify yet (3/15 examples)" | **PASS** |
| 23 | ML clustering | Real counts | Renders real donor counts | **PASS** |
| 24 | Chatbot open + chip click | Reply appears | Fallback reply (no Gemini key — graceful degradation) | **PASS** |
| 25 | Chatbot benign message ("hello") | Greeting, no emergency banner | Correct fallback greeting | **PASS** |
| 26 | Chatbot "PIMS Islamabad blood info" chip | hospital_info reply, **no** emergency alert | **False emergency triage alert** — classifier labels it `emergency_sos` at 17% confidence (see B2) | **FAIL** |
| 27 | Map tiles render | OSM tiles visible | Tiles present | **PASS** |
| 28 | Map city jump chips | Recenter | Buttons work, no errors | **PASS** |
| 29 | Hospital card select | Card highlight + map popup + marker highlight | borderColor=var(--blood), popup "Holy Family Hospital (HFH)…", scale-125 marker | **PASS** |
| 30 | Hotline tel: links | tel: hrefs | All 4 present | **PASS** |
| 31 | Hero anchor links | Jump to sections | `#emergencies-board`, `#sos-form` both exist | **PASS** |
| 32 | Mobile menu button | Opens menu | Hidden on desktop viewport — not testable here (Phase 4 covers responsive); panel content is empty in code (B12) | **UNVERIFIED** |
| 33 | SMS webhook (API level) | Parse + create SOS + honest reply | "Request received, but no O+ donors…" | **PASS** |
| 34 | Auth login/me (API level) | — | Fake token string, `/me` returns first user (B1) | **FAIL (known gap)** |

\* Ticker dismissal is functionally correct; residual hidden node noted as minor.

## 6. Changes Made in Phase 0

1. **`backend/services/dbService.ts`** — fixed TS union bug in `logDonation` (return type now `{error} | {donor}` via an `ok` discriminant; mongo branch no longer leaks the raw update shape).
2. **`backend/routes/donorRoutes.ts`** — (a) caller updated for the new return shape; (b) **route mismatch fix**: reviews now read `patientName` (fallback `reviewerName`) matching the frontend payload and seed data.
3. **`src/vite-env.d.ts`** — added (fixes `import.meta.env` and `.png` module types; 2 of the 3 typecheck errors).
4. `package-lock.json` changed by npm install (no dependency changes).

All changes verified: `tsc --noEmit` clean, `npm run build` succeeds, review flow click-tested end-to-end.

## 7. Prioritized Bug List

### P0 — live-critical (block real use / safety)

- **B1. No real authentication.** `authRoutes.ts` accepts any email with no password and returns a hardcoded string (`"bloodradar_jwt_token_safeer_khan_secret"`); `/me` returns `users[0]`. Frontend doesn't call it at all. *(Master prompt gap #1 — confirmed)*
- **B2. Chatbot false emergency alerts.** `POST /api/ml/classify-chat` labels "PIMS Islamabad blood info" as `emergency_sos` at 17% confidence, and `chatRoutes` fires the "High Urgent Triage" alert with **no confidence threshold**. Hospital/camp queries can trigger emergency UI falsely. Confirmed live.
- **B3. Donor phone numbers fully public.** `GET /api/donors` returns full numbers; every donor card renders the number and a copy button. No masking/contact-reveal flow. *(Gap #5 — confirmed; also SOS board exposes requester phones via tel: links and the ticker/notification text broadcasts patient name + phone to everyone.)*
- **B4. Identity is client-claimed.** Availability toggle and donation logging take `phone` from the request body — anyone can flip or log for any donor whose phone they know. Same for reviews (unauthenticated, any donor). *(Gap #2 — confirmed)*

### P1 — trust & honesty (core brand principles)

- **B5. Hospital stock shown as live when it's seed data.** 6 hospitals show In Stock/Low/Critical badges with no "Sample data" label or timestamp. *(Gap #3 — confirmed)*
- **B6. Unverifiable superlatives in copy.** Hero: "Pakistan's **most intelligent** blood donation network. **AI-powered matching**…" — matching is rule-based (`bloodCompatibility.ts`), not AI. Meta description has the same claim. *(Gap #4 — confirmed)*
- **B7. False "Gemini 3.5 Triage Engine" label** in chatbot header — the code calls `gemini-1.5-flash`; "3.5" doesn't exist. Also header brand reads **"BloodLink AI"** while the rest of the product is "BloodRadar" — inconsistent branding.
- **B8. Seed emergencies shown as live with past dates.** Two seed SOS cards display "Required by 2026-05-26 / 2026-05-28" (5 months ago) as active pending requests. Seed data must be labeled `isSample` or dated. *(relates to Gap #3)*
- **B9. OTP is always console-logged**, even in production (`console.log("[OTP] Verification code for …")` in `send-otp`). The API response correctly hides the OTP in production, but the log violates principle 4.
- **B10. Stats label inflation.** Analytics tile says "Verified Donors" but counts all donors including unverified (8 = 7 seed + my test donor). Minor but an honesty nit.

### P2 — robustness & hygiene

- **B11. No rate limiting, no helmet, no Zod, no tests, no security headers** on any route (SOS/OTP/login unprotected from abuse). *(Gap #8 — confirmed; nothing in package.json or server.ts.)*
- **B12. Mobile menu opens an empty panel** — the dropdown has no content.
- **B13. Ticker dismiss leaves a hidden DOM node** (AnimatePresence exit cleanup). Cosmetic.
- **B14. Recharts warns `width(-1)/height(-1)`** when the analytics tab is rendered hidden; charts work when visible. Cosmetic.
- **B15. Duplicate donor registration allowed** — same phone can register unlimited times (no unique index/check). Also camp "Register" can be spammed repeatedly.
- **B16. Two identical `mlEngine.ts` copies** (src/lib and backend/lib, diff = identical, 1,136 lines each). *(Gap #6 — confirmed)*
- **B17. Urdu strings** remain throughout with a locked `lang='en'` state — acceptable per the prompt's "keep the locked flag" option, but ~40 dead code paths if not cleaned. *(Gap #7)*
- **B18. Free-tier Render cold starts** — render.yaml is a single web service with no always-on plan; first load will sleep. *(Gap #9)*

## 8. Founder Decisions Needed Before Phase 1

The following are gating for Phase 1 (auth, privacy, rates) — per the master prompt I must ask, not invent:

1. **MongoDB Atlas** connection string (or continue in-memory for dev).
2. **SMS provider choice** (Twilio vs local Pakistani gateway) and account/credentials.
3. **Gemini API key** (chatbot currently runs on fallbacks only).
4. **Contact-reveal policy confirmation**: masked phones until donor accepts a specific SOS — confirm this is the chosen flow (it changes data model and UI).
5. **Domain name** (and whether to deploy now or after Phase 1–2).
6. **Sentry** account for observability (later phase).

## 9. Phase 0 Verdict

Build green, all 20 frontend↔backend routes verified (1 mismatch fixed), 33/34 interactive elements pass in the click matrix. The one functional failure (chatbot false triage, B2) plus the P0 security/privacy gaps are exactly the work Phase 1 exists to fix. **Ready for approval to proceed to Phase 1.**
