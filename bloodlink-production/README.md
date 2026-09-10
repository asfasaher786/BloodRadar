# 🩸 BloodRadar — Emergency Blood Coordination Platform

A platform to help people in Islamabad & Rawalpindi find compatible blood donors faster during emergencies.

**Mission:** No one should lose their life because compatible blood could not be found in time.

## ✨ What's real and working right now
- **Frictionless SOS requests** — only a phone number is required; hospital and patient name are optional, with the system defaulting sensibly if skipped
- **Instant donor matching** — real blood-type compatibility logic, filtered by city and live availability
- **Donor phone verification (OTP)** — donors are listed immediately, with an honest "Verified" / "Unverified" badge based on real phone confirmation
- **Real donation logging** — donors self-report completed donations; badges and stats are computed from real logged data, with a genuine 90-day medical eligibility gap enforced
- **WhatsApp broadcast fallback** — when the platform's own donor pool is thin, a one-tap share button generates a ready-to-forward message, honestly extending reach beyond the app
- **SMS fallback (logic built, not yet connected to a live number)** — the code can parse a plain SMS like "O+ ISLAMABAD" and create a real matching request; wiring this to a real SMS gateway is the one remaining step
- **Real ML Lab** — an urgency classifier that retrains on your actual database of real requests, honestly reporting "not enough real data yet" until there's enough to trust; real donor-location clustering for camp planning, using only real registered donors, no synthetic data
- **Bilingual** — English & اردو throughout

## ⚠️ Known limitations — please read before evaluating
- **Hospital blood-stock numbers shown in the directory are seed/demo data, not live inventory.** No real hospital is currently feeding this platform real stock levels. Treat any "In Stock / Low / Out of Stock" badge as illustrative, not actionable, until a real hospital partnership exists.
- **The donor pool is currently small** (seed data + whoever has registered during testing) — matching quality depends entirely on real donor signups, which this platform doesn't have at scale yet.
- **SMS fallback isn't live** — the parsing logic works, but no SMS number is connected yet.
- Age/health eligibility questions are self-reported checkboxes, not medically verified — appropriate for an MVP, not a substitute for a real donor screening process.

## 🚀 Deploy
See `render.yaml` — this project is pre-configured for Render. Push to GitHub, connect the repo on Render, and set the environment variables listed in `render.yaml` (`MONGO_URI`, `GEMINI_API_KEY`, `FRONTEND_URL`, `BACKEND_URL`).

## 🧪 For collaborators evaluating this project
See `COLLABORATOR_TESTING_GUIDE.md` for a step-by-step walkthrough of what to test and what feedback would help most.
