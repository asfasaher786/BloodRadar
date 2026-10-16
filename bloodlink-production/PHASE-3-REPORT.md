# BloodRadar — Phase 3 Delivery Report

**Date:** 2026-10-16 · **Branch:** `main` · **Scope:** north-star features — abuse controls, transparent donor ranking, organization portal, admin dashboard, notifications, SMS incoming channel, honest AI triage.

Everything in this report was verified by an automated test, a direct API call, or by clicking through the real UI. Where something could not be verified (because it needs the founder's credentials or real production data), it is listed under *Founder-needed* — nothing there is presented as working.

---

## 1. What Phase 3 delivered (P3.1 – P3.7)

### P3.1 Abuse controls
- Per-phone SOS caps and duplicate-request detection: the same phone re-asking for the same blood group gets the honest answer — "we already have your open request" — instead of creating a second SOS.
- Report-a-request button on every SOS card; reports land in the admin moderation queue (`/api/admin/reported`) with dismiss action.
- Rate limiting from Phase 1 covers the paths abusers target first (SOS spam, OTP abuse, chat cost abuse).

### P3.2 Transparent donor ranking (no fake ML)
- Rule-based, explainable donor score: blood compatibility, distance, availability, last-donation eligibility (90-day rule), and past response rate.
- Every ranked donor shows a "why this donor" explanation — nothing is a black box, and the UI never claims a neural network where there isn't one.

### P3.3 Organization portal (lightweight)
- NGO/hospital accounts can apply with proof of identity, get verified by an admin, post requests on behalf of patients, and mark them fulfilled.
- Only verified blood banks can update stock, and every stock update is timestamped and lands in the audit trail.
- Admins approve or reject applications from the dashboard.

### P3.4 Admin dashboard
- Moderation queue for reported SOS, organization approvals, and a full audit-log tab.
- North Star metric: units delivered = Σ unitsNeeded over Fulfilled requests, split real vs sample data. Median time-to-first-contact is shown as **null honestly** until real contact-request data exists — never fabricated.
- Anonymized CSV export (`/api/admin/export.csv`): id, timestamps, blood group, units, city, hospital, urgency, status, postedBy, sample flag — **no patient names, no phone numbers**.

### P3.5 Notifications (donors)
- Every matching SOS now alerts eligible donors through their chosen channels: in-app, SMS (via the provider abstraction), and web push (VAPID via web-push).
- Per-donor preferences: app alerts, SMS alerts, quiet hours (start/end) with an "allow Immediate SOS during quiet hours" opt-in — evaluated in `NOTIFICATION_TZ` (default Asia/Karachi), with overnight windows handled correctly.
- Targeted alerts carry the requester's **masked** contact and are excluded from the public feed; "read-all" only clears the owner's own targeted alerts.
- Honest web-push state: without VAPID keys the UI says push is "not configured" instead of pretending (see §4).
- SMS is **opt-in only** (`smsAlerts` defaults to false) — nobody gets unsolicited texts.

### P3.6 SMS incoming channel (live-ready)
- `/api/sms/incoming` accepts both Twilio-style (`From`/`Body`) and generic (`from`/`text`/`msisdn`/`message`) gateway payloads — providers can be swapped via env config without code changes.
- Strict-format parse first (blood group + city shorthand), Gemini messy-text parsing as fallback, and if both fail the reply honestly says so — never guesses a blood group.
- Parse failures are audit-logged (`sms_parse_failed`) and server-logged so real-world messages can improve the parser.
- Webhook authentication: when `SMS_WEBHOOK_SECRET` is set, calls must prove it (`x-webhook-secret` header or `Authorization: Bearer`, constant-time comparison); unset = open webhook in dev, with a loud production boot warning.
- SMS-created SOS trigger the exact same donor alert pipeline as the web flow.

### P3.7 AI (only where it adds value — and only honestly)
- Chatbot triage: Gemini (gemini-1.5-flash) when `GEMINI_API_KEY` is set; local rules-based clinical fallback otherwise. Emergency phrasing only triggers emergency framing above a 0.6 classifier-confidence gate.
- **Honest labeling:** every chat reply now carries its real source (`gemini` or `fallback`); `/api/chat/status` tells the UI whether AI is configured; the header and fallback messages label themselves ("Offline assistant · rules-based", "Rules-based answer · no AI connected"). The old hardcoded claim "Gemini 3.5 Triage Engine" (a model that doesn't exist) is gone.
- Messy-text parsing uses strict JSON-shape validation and returns null on any failure — the caller gives an honest "couldn't read your blood group" reply.
- The Real ML urgency model remains gated by ≥15 real labeled examples and says so in the UI — confirmed in backend code and surfaced in the Real ML Lab panel.
- Fallback content uses only real seeded hospital data (PIMS +92 51 9261170, Holy Family +92 51 9290321, Shifa +92 51 8463000 — all present in the seed database).

---

## 2. Evidence

- **Tests:** 94/94 passing across 13 files (`npm test`), including 16 donor-alert tests, 6 SMS-parsing tests, webhook-auth tests, and 5 chat-honesty tests.
- **Typecheck:** `tsc --noEmit` clean. **Production build:** Vite + server build both succeed.
- **Route cross-check:** every frontend `fetch()` path was matched against a mounted backend route — zero mismatches.
- **Live verification (dev server, in-memory DB):**
  - Admin dashboard: panel appears after OTP login without a reload (the stale-role bug was fixed); live counts, report dismissal, org approval, honest North Star (null median), CSV download all exercised.
  - Donor alerts: O+ Islamabad SOS created via curl appeared live in the donor's "Recent alerts" via SSE; quiet-hours suppression and Immediate bypass verified by tests.
  - SMS webhook: `From/Body` and `from/text` payloads both created real SOS with masked contact (`+92 300 •••• 233`); "2 compatible O+ donors nearby have been notified"; unparseable message returned the honest reply and produced an `sms_parse_failed` audit entry.
  - Chatbot: header shows "Offline assistant · rules-based" (no Gemini key in dev), replies carry the "Rules-based answer · no AI connected" badge, emergency phrasing returns triage framing with the 0.6 gate.
- **Browser console/network:** full page load shows zero 404s and zero JS errors; the only non-200 responses are the expected `401` on `/api/auth/me` when logged out.

---

## 3. Not built — by design (from the master prompt)

- **Email channel:** the master prompt marks email as *optional*. SMS (opt-in) + in-app + web push were built; email was deliberately skipped, not forgotten.
- **Optional-later items:** proactive donation-drive scheduling, multi-language (Urdu strings exist but stay disabled behind the locked `lang` state), and multi-country regulation logic were **not built**, per the master prompt.
- **Drive scheduling / multi-country compliance** are explicitly deferred; the white-label groundwork (below) is the hook they would hang on.

---

## 4. White-label readiness (international buyer/collaborator goal)

- **Cities:** config-driven — `SUPPORTED_CITIES` in `backend/config/regions.ts` (currently Islamabad, Rawalpindi); adding a city = one list entry + coordinates (and its SMS shorthand in `smsRoutes.ts`, noted in a comment there).
- **Country code:** `COUNTRY_CODE` env var (default "92") flows through phone normalization — a new deployment sets its own.
- **SMS provider:** swappable via `SMS_PROVIDER` env — console (dev) and Twilio implemented behind one interface; a Pakistani provider can be added as a third implementation without touching call sites.
- **Webhook secret:** `SMS_WEBHOOK_SECRET` per deployment.
- **Timezone:** `NOTIFICATION_TZ` per deployment for quiet-hours evaluation.
- **English-only UI** confirmed; roles (admin/hospital_staff/ngo/donor) driven by env phone lists, so a partner can self-configure staff.

---

## 5. Founder-needed (before Phase 5 deploy — none of these are invented or guessed)

1. **MongoDB Atlas** connection string (free tier is fine to start) — the app currently runs on the in-memory fallback DB.
2. **Gemini API key** — without it, the chatbot and SMS parsing run on the local fallback (which works, but is rules-based).
3. **SMS gateway account** — Twilio (already implemented) or a Pakistani provider (needs a small adapter). Needed for real outbound SMS and for pointing a real number at `/api/sms/incoming`; set `SMS_WEBHOOK_SECRET` when you do.
4. **VAPID keys** for web push — or a decision to skip push for launch (the UI already handles "not configured" honestly).
5. **Domain name** — for HTTPS, canonical URLs, OG tags, and the PWA service worker (which only registers in production).
6. **Contact-reveal policy confirmation** — currently: a donor accepts a contact request, then the requester's real phone is revealed to that donor, with the interaction audit-logged. Confirm this is the policy you want before any real traffic.
7. **Real hospital/NGO partner accounts** — the org portal is live but empty; real inventory needs real partners.
8. **Legal review** of the privacy policy and health-data handling before production traffic.
9. **Sentry DSN** (optional) for error tracking.

---

## 6. Commits (all local on `main`, not pushed)

| Commit | Scope |
|---|---|
| `966da59` | Abuse controls: duplicate detection, per-phone caps, report button |
| `f370685` | Transparent donor ranking: explainable rule-based score with why-tooltip |
| `f2c8893` | Organization portal: verified NGO/hospital accounts with admin approval |
| `7ce865a` | Admin dashboard: North Star metric, moderation queue, org approvals, anonymized CSV |
| `d1d20c8` | Donor alerts: matched-SOS notifications with quiet hours, channels and web push |
| `7a7e6a1` | SMS incoming: webhook secret auth, parse-failure audit log, donor alerts |
| `d1cb07b` | AI triage honesty: chat replies labeled by source, honest status endpoint |

---

## 7. Honest report card

Phase 3's seven features are implemented, tested, and verified end-to-end in development. What Phase 3 **cannot** do yet — and doesn't claim to — is send a real SMS through a paid gateway, push a real browser notification without VAPID keys, answer chat via Gemini without a key, or persist data without a MongoDB URI. Those are exactly the founder-needed items in §5, and the product is built so each of them is a configuration step, not a code change.
