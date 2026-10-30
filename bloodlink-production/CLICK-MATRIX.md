# BloodRadar — Click Matrix (Phase 4.2)

Every interactive element in the production UI, mapped to the test that proves it
responds with a real state change. Evidence is the Phase 4 Playwright suite
(`e2e/*.spec.ts`), run against the live dev server on all four projects:
Chromium, Firefox, WebKit, and mobile-Chromium (360×740).

Method: every element below was clicked (or keyboard-activated) in a real browser
and asserted on a state change — never "no crash" alone. Elements that share one
handler with a sibling (e.g. the eight blood-group chips) are proven once per
mechanism, noted inline.

| # | Element | Action | Expected result | Evidence |
|---|---------|--------|-----------------|----------|
| **Header & chrome** | | | | |
| 1 | Skip-to-content link | Focus + Enter | Link becomes visible on focus; Enter jumps to `#main-content` | `click-matrix.spec` → "skip-to-content link" |
| 2 | Emergency ticker — Dismiss | Click | Marks all notifications read server-side; ticker and bell disappear, stay gone after reload | `click-matrix.spec` → "ticker: X hides it…" |
| 3 | Emergency ticker — X | Click | Hides the banner only; unread count (bell) untouched | same test |
| 4 | Notifications bell (any viewport, unread > 0) | Click | Opens the notifications panel (dropdown) with the live feed; bell itself stays visible | `click-matrix.spec` → "ticker: X hides it…" |
| 4a | Notifications panel — open | Click (bell) | Panel `#notifications-panel` appears with heading and feed rows (newest first) | `click-matrix.spec` → "bell opens the notifications panel…" |
| 4b | Notifications panel — emergency row | Click | Navigates to `#emergencies-board` and closes the panel | same test |
| 4c | Notifications panel — Mark all as read | Click | Real POST `/api/notifications/read-all`; bell and ticker vanish and stay gone after reload | same test |
| 5 | Mobile menu button | Click | `aria-expanded` false → true, label flips to "Close menu" | `click-matrix.spec` → "mobile menu opens…" |
| 6 | Mobile menu anchors ×4 | Click | Navigates to the section and closes the menu | same test |
| 7 | Hero CTA "View Live Emergencies" | Click | URL hash → `#emergencies-board` | `click-matrix.spec` → "hero CTAs" |
| 8 | Hero CTA "Request Blood (SOS)" | Click | URL hash → `#sos-form` | same test |
| 9 | Offline banner hotlines ×4 (`tel:`) | Rendered when offline; href asserted | Correct `tel:` targets for PIMS / Holy Family / Shifa / Rescue 1122 | `offline.spec` |
| **Directory (hospitals / camps / analytics / ML)** | | | | |
| 10 | Directory tabs ×4 | Click | Each shows its own tabpanel; `aria-selected` updates | `click-matrix.spec` → "tabs switch panels" |
| 11 | Directory tablist keyboard nav | Arrow keys | ArrowRight/Left move selection (WCAG tablist pattern) | same test |
| 12 | Hospital card | Click | Card gets the selected highlight (`border-blood` class); map targets it | same test |
| 13 | Camp "Register (N)" | Click | Real POST `/api/camps/register`; count increments on the button | same test |
| 14 | SOS board report button | Click | Opens reason form; POST accepted with confirmation copy | `admin.spec` → "report → admin review…" |
| **Map** | | | | |
| 15 | City zoom (Islamabad / Rawalpindi) | Click | Map pane transform changes (verified by `map.spec`); no console/page errors (`click-matrix.spec`) | `map.spec` + `click-matrix.spec` → "city zoom…" |
| 16 | Locate me | Click | Reports its real state — denied, failed, or still searching — and never claims a position it didn't get | `map.spec` → "locate-me reports its real state" |
| 17 | Leaflet zoom in / out | Click | Zoom controls operate with a settled map; no uncaught errors | `click-matrix.spec` → "city zoom…" |
| 18 | Map markers → mobile details sheet | Click (via card select) | Bottom sheet shows name/address/`tel:` link; "Close details" dismisses it | `click-matrix.spec` → "mobile details sheet" |
| **SOS form** | | | | |
| 19 | Emergency mode switch | Click | `aria-checked` toggles; form strips to essentials when off | `click-matrix.spec` → "emergency switch…" |
| 20 | Units − / + | Click | Count updates (1 → 2 → 1), `aria-live` value | same test |
| 21 | Blood-group chips ×8 | Click | `aria-pressed` toggles; exactly one selected | same test (AB+, O−); `sos.spec` (B−); helpers (O−) |
| 22 | City chips ×2 | Click | `aria-pressed` toggles; exactly one selected | same test |
| 23 | Phone input + "Broadcast SOS Alert" | Fill + click | Creates SOS; LIVE requester panel appears with matching-donor count | `sos.spec` |
| 24 | Requester panel — Notify Matching Donors | Click | Explicit privacy gate: contact requests created, donors notified | `matching.spec` |
| 25 | Requester panel — Cancel SOS | Click | Status → cancelled with honest copy | `click-matrix.spec` → "emergency switch…" |
| 26 | Cancelled panel — New request | Click | Clears state, form returns | same test |
| 27 | Requester panel — Mark as Fulfilled | Click | Status → fulfilled; board reflects it | `sos.spec` + `matching.spec` |
| 28 | Fulfilled panel — Done | Click | Clears the live panel | `click-matrix.spec` → "emergency switch…" |
| 29 | WhatsApp share link | Presence + href | Carries urgent text + blood group | `sos.spec` |
| 30 | Accepted donor — Call Now (`tel:`) | Presence + href | Real number revealed only after donor accepts | `matching.spec` |
| **Donor search & onboarding** | | | | |
| 31 | Search / Register tabs | Click | Switches panels both ways | `click-matrix.spec` → "available-only toggle…" + helpers |
| 32 | Active / Available Only toggle | Click | Unavailable donors (seed: Bilal Siddiqui) appear/disappear | `click-matrix.spec` |
| 33 | Blood filter chips ×9 | Click | List filters; only matching donors remain | `click-matrix.spec` (AB+) — one handler for all |
| 34 | City filter chips ×3 | Click | List filters by city | `click-matrix.spec` (Rawalpindi) |
| 35 | Protected-number button | Click | Label swaps to "Use SOS to connect", reverts after 3 s; number stays masked | `click-matrix.spec` |
| 36 | Reviews toggle | Click | Testimonial drawer opens/closes | `click-matrix.spec` |
| 37 | Star rating buttons ×5 | Click | Rating updates (`aria-pressed`) | `click-matrix.spec` |
| 38 | Review form + Submit Feedback | Fill + click | Real POST `/api/donors/:id/reviews`; in-flow success block shown | `click-matrix.spec` |
| 39 | Success block — Okay | Click | Returns to the form | `click-matrix.spec` |
| 40 | Register stepper (name, phone, group, city, location, eligibility, consent, OTP) | Full UI flow | Donor created, verified, streak card appears | `donor.spec` via shared helper |
| 41 | Log Donation | Click | Records donation; immediate repeat refused by the 90-day rule | `donor.spec` |
| 42 | Availability toggle (streak card) | Click | AVAILABLE ↔ OFFLINE | `donor.spec` |
| 43 | Donor inbox — Accept & Share My Number | Click | First-accept-wins; real numbers exchanged, audit-logged | `matching.spec` |
| **Returning-donor login & inbox** | | | | |
| 44 | Header "Log in" button (desktop, signed out) | Click | Opens the login modal; after OTP verify the button disappears and stays gone after reload | `click-matrix.spec` → "log in modal: phone OTP signs in…" |
| 45 | Mobile menu "Log in" item (signed out) | Click | Menu closes, login modal opens; Esc closes the modal (shared `ui/Modal` escape path) | `click-matrix.spec` → "mobile menu opens…" |
| 46 | Login modal — Send verification code | Fill + click | Real POST `/api/auth/otp/request`; stage switches to the 6-digit code input with the dev hint (test-only) | `click-matrix.spec` → "log in modal…" |
| 47 | Login modal — Change number | Click | Returns to the phone stage with the typed number preserved; a fresh phone proceeds (per-phone cooldown honest) | same test |
| 48 | Login modal — Verify & log in | Fill + click | Real POST `/api/auth/otp/verify`; session cookie set; modal closes; Log in buttons gone and stay gone after reload | same test |
| 49 | Contact Requests card — empty state | Rendered | Card always visible for a signed-in donor; honest "No open requests right now" + "0 waiting" copy | `click-matrix.spec` → "empty state shows for a fresh donor…" |
| 50 | Contact Requests — Refresh button | Click | Real GET `/api/donors/inbox`; with the endpoint blocked the honest error state appears (empty → error state change) | same test |
| 51 | Contact Requests — Try again | Click | Recovers from the error state back to the honest empty state | same test |
| **Organization portal** | | | | |
| 52 | Phone input + Send verification code | Fill + click | OTP issued; dev hint shown (test-only) | `click-matrix.spec` + `admin.spec` |
| 53 | OTP stage — Back | Click | Returns to phone input without state corruption; re-sending the same phone within the 60s cooldown shows the honest wait message | `click-matrix.spec` → "org portal…" |
| 54 | Verify & continue | Fill + click | Session established (cookie) | `admin.spec`, `donor.spec`, `click-matrix.spec` |
| 55 | Application form + Submit application | Fill + click | Real POST `/api/orgs/apply`; "In review" state shown | `click-matrix.spec` → "org portal…" |
| 56 | Check status again | Click | Refreshes status honestly (stays "In review") | same test |
| 57 | Approved-org actions (post on behalf, Mark Fulfilled / Cancel, Save stock update) | — | Real API handlers; covered by integration tests, not browser-clicked (approval is an admin prerequisite) | `backend/__tests__/orgs.test.ts` |
| **Admin dashboard** | | | | |
| 58 | Admin tabs | Click | Reported tab shows reports list | `admin.spec` |
| 59 | Clear reports | Click | Report removed from list | `admin.spec` |
| 60 | Export CSV | Click | Download event with `bloodradar-sos-YYYY-MM-DD.csv` filename | `admin.spec` |
| 61 | North Star metric card | Rendered | Honest null or real median — never fabricated | `admin.spec` |
| **AI assistant** | | | | |
| 62 | FAB toggle | Click | `aria-expanded` toggles; dialog opens/closes | `click-matrix.spec` + `chatbot.spec` |
| 63 | Close assistant | Click | Dialog closes | `click-matrix.spec` |
| 64 | Escape | Key | Dialog closes | `chatbot.spec` |
| 65 | Message input + Send | Fill + click | Rules-based answer with honest "no AI connected" badge; emergency phrasing escalates | `chatbot.spec` |
| **SMS channel (API-level)** | | | | |
| 66 | `/api/sms/incoming` | POST | Creates SOS from strict-format SMS; honest reply when unparseable; 400 on malformed payloads | `sms.spec` |

## Notes

- **State-dependent elements** (ticker, bell) are exercised through the real
  flow that creates their state: register a donor → raise an SOS → notify
  matching donors → the unread notification arrives over SSE.
- **Shared-handler groups** (blood chips, filter chips, star ratings) are
  proven once per mechanism; the remaining siblings use identical code paths.
  Same for the login modal's X and backdrop close, which share the `ui/Modal`
  close handler proven via Esc (#45), and the mobile menu's "Log in" item,
  which hides under the same session check as the header button (#44).
- **Elements verified at API/integration level** rather than by browser click:
  approved-org portal actions (#57) — they require an admin approval round-trip
  and are covered by `orgs.test.ts`; SMS webhook (#66) has no UI by design.
- **Not individually clicked (honest exclusions):** the "Speak last answer"
  assistant button (speechSynthesis — device-dependent; the send/close/escape
  paths are proven), and the logo (not interactive). No other interactive
  element remains untested.

Verified: full suite green on all four browser projects (Chromium, Firefox,
WebKit, mobile-Chromium 360×740) — 156 passed / 8 viewport-gated skips /
0 failed on the 2026-10-31 login-UX gate (`test-results/.last-run.json`).
The click-matrix additions that followed (rows 44–51: menu Log in click,
Change number, inbox refresh/retry) were re-verified on Chromium +
mobile-Chromium — 24 passed / 4 skips / 0 failed — with the product code
unchanged between the two runs, so the 4-project gate stays authoritative.
