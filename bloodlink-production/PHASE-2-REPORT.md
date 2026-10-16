# BloodRadar — Phase 2 Delivery Report

**Date:** 2026-10-16 · **Branch:** `main` · **Scope:** frontend design system, honest UX, motion, accessibility (WCAG 2.2 AA), PWA + code splitting.

Everything in this report was verified by an automated test, a computed check (contrast math), a direct API call, or by clicking through the real UI. Where something could not be verified (because it needs the founder's credentials or real production data), it is listed under *Founder-needed* — nothing there is presented as working.

---

## 1. What Phase 2 delivered (P2.1 – P2.10)

### P2.1 Design system + tokens (Tailwind 4 `@theme`)
- Full token set in `src/index.css`: brand `blood` #C41230, `safe` #00C48C, `warn` #FFB300, `gold`, neutrals (`ink`, `surface`, `card`, `muted`, `border`) — every pairing audited for WCAG contrast before adoption.
- `-ink` variants for AA text (`safe-ink` #007A57, `warn-ink` #8A5A00) and `-soft` tints for callouts; `border-strong` #8F8A82 introduced for form-control borders (3.03:1 vs surface, 3.43:1 vs white — WCAG 1.4.11).
- Legacy `var(--…)` aliases kept so older inline styles keep working; all three `-soft` aliases now resolve (a missing-alias bug found and fixed during P2.10 — see §4).

### P2.2 Component library (`src/components/ui/`)
- `Button`, `Input`, `Select`, `Badge`, `Card`, `Stepper`, `Tabs`, `Skeleton` (+ `SkeletonCard`, `SkeletonList`, `SkeletonStats`), `AnimatedNumber` — one consistent API, all keyboard and screen-reader friendly.

### P2.3 Honest copy pass
- Every label states what it actually does — no "Notify all donors" when only matching donors are contacted, no fake counts. The ML panel explicitly says it trains on the platform's real database; the sample-data banner says the data is demo seed data.

### P2.4 SOS flow redesign
- Anonymous, 3-tap emergency flow: phone → blood group chips → units stepper → city → submit. Requester panel shows masked status, the one-time code, live matching count, contact-reveal state, and cancel — all reflecting real backend states.

### P2.5 Donor onboarding stepper
- Multi-step register flow (identity → blood group → eligibility consent → phone OTP). **Deviation from the master prompt:** OTP verify is kept **required** in onboarding, even though the master prompt lists it as optional. Reason: Phase 1's privacy design only creates a donor record after phone proof, so a donor without verification would be un-contactable in an emergency — the core promise of the product. (Can be relaxed later with a "unverified" donor tier if the founder wants.)

### P2.6 Discovery: sample-data banner + badges
- Clear "sample data" notice; donor streak/eligibility badges, availability toggle, review system with star ratings.

### P2.7 Map upgrades
- Leaflet map with hospitals + camps, marker clustering, city switching (Islamabad / Rawalpindi), locate-me with honest status messaging, mobile bottom sheet for selected items.

### P2.8 Motion: entrances, skeletons, reduced-motion
- Entrance-only animations on load; full-page skeleton while loading; live-update highlight flash on SOS cards that changed via SSE (1.6 s, auto-clears).
- `MotionConfig reducedMotion="user"` + a CSS reduced-motion block — JS and CSS motion both honour the OS setting (WCAG 2.3.3).
- **Rule established (and why):** overlays/dismissible panels use *entrance-only* motion, never `AnimatePresence` exit gating. Exit animations never complete in throttled/background tabs (paused rAF) and leave overlays stuck open — found live in the browser and fixed everywhere (chatbot, mobile menu, ticker).

### P2.9 Accessibility (WCAG 2.2 AA)
- Skip link, semantic landmarks (`main`, heading hierarchy), keyboard-accessible directory tabs (arrows/Home/End, roving focus), focus-visible outlines (2px blood), visible labels on every input, `fieldset`/`legend` for the star rating, aria-live regions for SOS counts, dialogs with focus trap + Escape, contrast fixes throughout (text, icons, star ratings, placeholders, buttons).

### P2.10 PWA + code splitting
- Hand-rolled PWA (no extra dependency): `manifest.webmanifest` (theme #C41230, standalone, 192/512/1024 icons incl. maskable), `public/sw.js` (prod-only registration; `/api/*` never cached; shell precache; navigations network-first → cached shell; static stale-while-revalidate), OG + Twitter share meta, apple touch/mobile-web-app meta.
- Code splitting: `React.lazy` + `Suspense` for MapComponent, AIChatbot, StatsDashboard, RealMLPanel with skeleton fallbacks — the 853 kB chunk warning is gone; the recharts payload (387 kB) only downloads when the Analytics tab opens.
- Offline banner: when the network drops, a warn-styled banner (role="status") says the map/live updates won't refresh and shows real `tel:` links to PIMS, Holy Family, Shifa and Rescue 1122.

---

## 2. Evidence

### Automated checks (final state)
- `npx tsc --noEmit` — clean.
- `npm test` — **42/42 passing** (7 files).
- `npm run build` — success; chunks: `index` 438 kB / `StatsDashboard` 388 kB / `MapComponent` 12.5 kB / `AIChatbot` 11 kB / `RealMLPanel` 7 kB (gzip 131.6 / 115.4 / 4.4 / 4.3 / 2.8 kB). No chunk-size warning.
- PWA assets served from the production bundle (`vite preview`): `/sw.js`, `/manifest.webmanifest`, all three icons, `/og-image.png` → all **200**; manifest parses with correct theme + icon sizes; `serviceWorker.register('/sw.js')` present in the built JS, gated by `import.meta.env.PROD`.

### Contrast math (WCAG, computed)
- warn-ink #8A5A00 on warn-soft #FFF3D6 = **5.37:1** (offline banner text, AA); on white 5.93:1.
- safe-ink on safe-soft / white, blood-ink on white — all ≥ 4.5:1 for text and ≥ 3:1 for UI components (verified across P2.8/P2.9 with a node contrast script; the list of fixed spots is in the P2.9 commit).

### Click-tested in the real browser (dev server, in-memory DB)
- Lazy chunks: map card renders from the lazy chunk; Analytics tab loads StatsDashboard with real numbers ("Verified Donors 7 / Active SOS Request 2 / …") and charts; ML lab tab loads; chatbot toggle renders, opens a `role="dialog"`, focuses its input, closes instantly on Escape.
- Offline banner: dispatching `offline` shows the banner with 4 `tel:` links and correct warn styling; `online` removes it immediately.
- SOS end-to-end (final flagship check): filled the real form (phone + blood chip + units), submitted anonymously → board went **2 → 4 pending via SSE** with no page reload, live region updated ("4 active emergencies pending"), new card rendered with backend defaults. Test SOS removed by dev-server restart (back to seed state: 2).
- Live-update highlight: verified in P2.8 with a MutationObserver on a status change (flash appears exactly once, auto-clears). New-card flash is applied at mount (class present when React inserts the card), so it plays once on insertion by design.
- Accessibility spot checks in the live DOM: skip link, tablist semantics (aria-selected, arrow-key focus moves), `main#main-content`, input borders resolving to #8F8A82, aria-live SOS region.
- Console: only the expected anonymous `401` on `/api/auth/me` and the informational reduced-motion notice, plus recharts `width(-1)` notices that occur only because the headless checker runs in a hidden viewport (charts render with correct size in a normal browser — the tab panel has a fixed-height container).

---

## 3. What is honest, not fabricated
- All numbers shown in the UI are either real responses from the backend (in-memory seed DB) or honestly labelled as sample data.
- The live map uses real Leaflet tiles; hospitals/camps/donors are the seed dataset.
- No "Notify all donors" style buttons — every action maps to a real, tested backend route (cross-checked against the Phase 0 route table).
- The ML panel is an honest local model over the platform's data — it does not pretend to call a cloud AI.
- PWA offline support means "the shell + cached static assets"; live data, search and SOS submission still require the network — the offline banner says exactly that.

---

## 4. Bugs found and fixed during Phase 2
- Missing legacy aliases `--warn-soft` / `--safe-soft` in `:root` (offline banner and the map's locate-me toast rendered with transparent backgrounds). Fixed in P2.10.
- Exit-animation stall: `AnimatePresence` exit gating left the chatbot and mobile menu stuck open in throttled/background tabs (paused rAF). Fixed with the entrance-only rule (§ P2.8).
- Contrast failures (white-on-warn 1.79:1, white-on-safe 2.26:1, input borders 1.35:1, amber-500/slate-300 stars, muted/70 placeholders) — all replaced with AA-passing tokens.
- Mismatched heading tags after the heading-hierarchy pass — fixed.

---

## 5. Founder-needed (do not invent — these block going live)
1. **MongoDB Atlas URI** — production DB (currently in-memory fallback for dev).
2. **SMS gateway account/credentials** — real OTP delivery (console provider used outside prod).
3. **Gemini API key** — only if the AI chatbot should be cloud-backed; the current assistant is local/honest-stub.
4. **Domain name + hosting target** — for CORS/`FRONTEND_URL`, cookies (`secure`), and the PWA's HTTPS requirement.
5. **Contact-reveal policy confirmation** — first-accept-wins + audit trail is implemented; the founder should confirm the policy wording shown to users.
6. **Legal review** — privacy policy, terms, and data-protection review before launch.

---

## 6. What Phase 3 will cover (per the master prompt)
North-star features on top of this foundation: richer SOS orchestration (notify-all with rate limits), hospital-side dashboards, donor gamification, and the white-label configuration layer (config-driven cities, swappable SMS provider, env-configurable country code) so the platform can be sold or co-built internationally.
