# BloodRadar — Deployment Runbook (Phase 5)

**Date:** 2026-10-18 · **Status:** READY — everything below is executable the moment founder credentials exist.
The code itself is complete: production build verified, fail-fast env gate verified, PWA + static serving verified (see PHASE-5-REPORT.md for the evidence).

---

## 1. Hosting decision (summary)

BloodRadar is **one always-on Node process** (API + built frontend in the same server, live SSE board, background reminder job). That rules out serverless (Lambda/Vercel-functions): SSE streams and background jobs don't map to it.

| Option | Cost | Verdict |
| --- | --- | --- |
| **Render, single web service (recommended)** | $7/mo (starter), always-on | Zero server admin: Git-push deploys, auto-HTTPS, health checks, env vars in dashboard. Closest region: Singapore. |
| AWS Lightsail | $5/mo flat | Best AWS path if the founder insists on AWS. Bahrain region available (closest to Pakistan). You manage the OS (steps in §6). |
| AWS EC2 t3.micro | free 12 months, then ~$9/mo | More manual setup (VPC, security groups, Elastic IP) and surprise-bill risk after year 1. Not recommended. |
| Render free tier | $0 | **Not recommended for an emergency app**: free services sleep after ~15 min of inactivity; a real SOS would wait 30–60 s for a cold start. |

**Decision rule:** Render $7/mo unless the founder specifically wants AWS, in which case Lightsail $5/mo (Bahrain). Both paths are documented below.

---

## 2. Founder checklist — what the founder must provide

Nine items, unchanged from Phase 3/4 findings. "Where and how" for each:

1. **MongoDB Atlas connection string** — free M0 cluster. Steps in §4. Format: `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
2. **Gemini API key** — https://aistudio.google.com/apikey → Create API key. (Without it the chatbot honestly degrades to fallback replies.)
3. **SMS gateway** — either:
   - Twilio: `SMS_PROVIDER=twilio` + Account SID, Auth Token, sender number (twilio.com/console), or
   - A local Pakistani gateway with an HTTP API: `SMS_PROVIDER=custom-gateway` + `SMS_GATEWAY_URL` (endpoint accepting POST `{to, text}` JSON) + optional `SMS_GATEWAY_API_KEY`.
4. **`SMS_WEBHOOK_SECRET`** — auto-generated on Render; on Lightsail generate with `openssl rand -hex 32`. The gateway must send it as `x-webhook-secret` (or `Authorization: Bearer`) on inbound messages (§8).
5. **VAPID keys** for web push — generate: `npx web-push generate-vapid-keys --json` → fill `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (operator mailto/URL). Absent = push UI says "not configured" (honest degradation, not a crash).
6. **Domain name** (optional but recommended) — a custom domain lets cookies/PWA/webhook URLs be stable. Without one, the Render `onrender.com` URL works too.
7. **Contact-reveal policy confirmation** — the app already implements: donor's full phone is never public; requester initiates a contact request; donor accepts; then both numbers are revealed to each other with an audit trail. The founder must confirm this policy in writing (it is a privacy-law-sensitive design decision).
8. **Real partner organizations** — verified hospital/NGO accounts to seed as approved orgs (their `ADMIN_PHONES`/`NGO_PHONES` go in env).
9. **Legal review** for emergency health data (Pakistan context) — outside engineering scope.

---

## 3. JWT secret

Required in production (≥32 chars); the server refuses to boot without it. Generate: `openssl rand -base64 48`. On Render it is auto-generated (`generateValue: true` in render.yaml).

---

## 4. MongoDB Atlas setup (founder, ~10 min)

1. Go to https://www.mongodb.com/atlas → sign up → **Build a Database** → **M0 Free** → provider `AWS` → region **Singapore** (aws-ap-southeast-1) — nearest to both Render-Singapore and Pakistan.
2. In **Database Access** → Add new database user: name `bloodradar-app`, password auto-generated (save it). Role: *Read and write to any database*.
3. In **Network Access** → Add IP address → **Allow access from anywhere** (`0.0.0.0/0`) — required for Render, whose outbound IPs are not fixed.
4. In **Deployment → Clusters → Connect → Drivers** → copy the connection string, replace `<password>` with the real one. Set it as `MONGO_URI` in the platform env (Render dashboard or Lightsail `.env`).

**Important behavior to know:** the server auto-creates the `bloodradar` database, all collections, and indexes on first connect, and seeds the sample dataset (flagged `isSample: true`). Production **refuses to boot without `MONGO_URI`** (P0-4), and if the Mongo connection fails at runtime the server falls back to an in-memory store and keeps serving — but that store is lost on restart, and `/health` reports **503** (not ok) while in that state, so the Render health check and any uptime monitor will see it. Watch the boot log for `db=mongodb` (correct) vs `db=fallback` (problem).

---

## 5. Render deploy (recommended path, ~20 min)

1. Push this repo to a GitHub repository the founder controls. *(Done 2026-10-18: 36 commits on origin/main at github.com/asfasaher786/BloodRadar.)*
2. Render dashboard → **New → Blueprint** → connect the repo. **Blueprint Path must be `bloodlink-production/render.yaml`** (the repo root is one level above the app; `rootDir: bloodlink-production` in render.yaml makes build/start run inside the app folder). The blueprint is already complete: build → start → health check `/health` → full env var set.
3. Fill the **Environment** values marked `sync: false`: `FRONTEND_URL` (e.g. `https://<service-name>.onrender.com` or the custom domain), `MONGO_URI`, `GEMINI_API_KEY`, SMS vars, VAPID vars, `ADMIN_PHONES`/`STAFF_PHONES`/`NGO_PHONES` (comma-separated `+92…` numbers).
4. Deploy → watch the log for `BloodRadar server listening … (production, db=mongodb, sms=twilio)`.
5. Run the post-deploy smoke checklist (§9).

---

## 6. AWS Lightsail alternative (if the founder wants AWS, ~1 hour)

1. **Create instance:** Lightsail → Create instance → region **Bahrain** (me-south-1) → platform Linux/Unix → blueprint **OS only → Ubuntu 24.04** → plan **$5** (1 GB RAM, 2 vCPU) → name `bloodradar`.
2. **Open ports:** instance → Networking → firewall: allow **22 (SSH)** [your IP only], **80**, **443**. (App itself listens on 3000 internally — never expose it.)
3. **Install Node 22** (via SSH terminal in Lightsail console):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
   ```
4. **Get the code:** either `git clone` from the founder's repo (then `git checkout main`), or upload the folder via SFTP (FileZilla / `scp`).
5. **Configure env:** create `/opt/bloodradar/.env` from `.env.example`, filling every value from §2 (same list as §7).
6. **Build & run:**
   ```bash
   cd /opt/bloodradar
   npm ci && npm run build
   sudo npm install -g pm2
   pm2 start dist/server.cjs --name bloodradar
   pm2 save && pm2 startup   # auto-start on reboot
   pm2 logs bloodradar       # expect: (production, db=mongodb, sms=twilio)
   ```
7. **HTTPS with Caddy** (auto Let's Encrypt):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install -y caddy
   ```
   `/etc/caddy/Caddyfile`:
   ```
   your-domain.com {
       reverse_proxy localhost:3000
   }
   ```
   `sudo systemctl reload caddy`. Point the domain's A record at the instance's **static IP** (Lightsail → Networking → Attach static IP first).
8. Run the post-deploy smoke checklist (§9). SSL is required in production: cookies are `secure` and HSTS is on.

---

## 7. Environment reference

Full list with defaults — mirrors `backend/config/config.ts` (single source of truth):

| Var | Required in prod | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `PORT` | yes | Render injects it; 3000 otherwise |
| `JWT_SECRET` | **yes** (≥32 chars) | server refuses to boot without it |
| `FRONTEND_URL` | **yes** | strict CORS + cookie origin |
| `BACKEND_URL` | no | same origin for the single-service setup |
| `MONGO_URI` | strongly | absent = in-memory fallback (dev only) |
| `GEMINI_API_KEY` | no | chatbot falls back honestly when absent |
| `GEMINI_MODEL` | no | default `gemini-1.5-flash`; chat replies + SMS parser; override for a newer model |
| `SMS_PROVIDER` | yes | `console` (dev), `twilio`, or `custom-gateway` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | if twilio | |
| `SMS_GATEWAY_URL` / `SMS_GATEWAY_API_KEY` | if custom-gateway | POST `{to, text}` JSON |
| `SMS_WEBHOOK_SECRET` | strongly | inbound webhook auth (boot warning if unset) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | all three → push enabled |
| `COUNTRY_CODE` | no | default `92` |
| `NOTIFICATION_TZ` | no | default `Asia/Karachi` |
| `ADMIN_PHONES` / `STAFF_PHONES` / `NGO_PHONES` | no | comma-separated `+CC` numbers |
| `ENABLE_DONATION_REMINDERS` | no | `"true"` only after SMS proven working |
| `SMS_ALLOWED_PREFIXES` | no | default `+92` — non-matching numbers get 429 on the OTP doors (P3a-7) |
| `SMS_GLOBAL_DAILY_CAP` | no | default `200` — daily outbound cap; only gates live providers, console is never capped |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | no | both required to enable the Cloudflare Turnstile bot check; absent = check is a no-op |
| `ADMIN_TOTP_RESET` | no | `"true"` wipes all admin two-step state at boot (§10); remove after one deploy |
| `LOG_LEVEL` | no | `info` |

Production rate limits are already strict in code (vs relaxed dev limits) and engage automatically on `NODE_ENV=production`.

---

## 8. SMS inbound webhook

`POST {BACKEND_URL}/api/sms/incoming` — the gateway must forward incoming donor replies here with header `x-webhook-secret: <SMS_WEBHOOK_SECRET>` (or `Authorization: Bearer <secret>`).

- **Twilio:** Console → Phone Numbers → the sender number → Messaging → *A message comes in* → Webhook URL `https://<backend>/api/sms/incoming`, method POST, and add the custom header (Twilio supports custom headers on webhooks) or put the secret in the URL as a query param and note it — the code checks the header first.
- **custom-gateway:** configure in the provider's panel per their docs.

**Confirm-back contract (P3b-2):** the platform sends the confirmation back to the sender itself, through its own outbound provider (guarded by the SMS allow-list + daily cap), using strict fixed templates (plain text, single SMS segment — see `backend/lib/smsConfirmBack.ts`). The webhook responds `{ ok: true, confirmBackDelivered: boolean }` — `confirmBackDelivered=false` means the outbound send was refused/failed while the request was still processed. The gateway must be configured to **not** auto-reply to the sender (Twilio ignores the JSON response anyway); otherwise senders get duplicate messages. Until a live outbound provider is configured (#52), confirm-backs print to the server log only.

Test after deploy: send "YES SOS-XXXX" style reply per the strict-format parser (see `backend/routes/smsRoutes.ts`) and confirm it appears on the board and the sender receives the confirm-back SMS.

---

## 9. Post-deploy smoke checklist

Run these against the live URL before announcing:

1. `GET /health` → `200`, `"environment":"production"`, `"mode":"mongodb"`.
2. Boot log line: `db=mongodb, sms=twilio|custom-gateway` (not `fallback`, not `console`).
3. Homepage loads over HTTPS; helmet headers present (`Strict-Transport-Security`, `X-Content-Type-Options`).
4. `GET /manifest.webmanifest` → 200; app installs as PWA on Android Chrome.
5. Register a real test donor (real OTP delivered by the gateway), raise an SOS, confirm SSE board update without refresh.
6. Contact-request flow: donor accepts → both numbers revealed → audit log row exists.
7. **Real-database verification** (the Mongo path is now one command):
   ```bash
   TEST_MONGO_URI="<the production connection string>" npm run test -- backend/__tests__/mongo.integration.test.ts
   ```
   Expect 3 passing (connect+seed, donor round-trip + unique index, SOS round-trip + status update). It cleans up after itself.
8. axe scan (`npx playwright test e2e/a11y.spec.ts`) — zero serious/critical (already gated; re-run against prod URL).
9. Push notification: subscribe in the app → server sends test push (requires VAPID vars).
10. Graceful shutdown: on Render, restart the service and confirm the log shows `SIGTERM received — shutting down gracefully` (the 10 s hard-exit fallback prevents hung deploys).

---

## 10. Admin two-step (TOTP) & SMS-pumping defences (Phase 3a)

**Why this exists:** an admin phone grants OTP-verified superuser access, and the OTP doors were the cheapest vector for an attacker (SIM-swap or spam attacks). Two independent layers shipped in Phase 3a:

- **P3a-8 admin two-step:** after the phone OTP, admin sign-in requires a second factor — a 6-digit authenticator-app code or a recovery code. Enrollment is optional but strongly recommended for every admin number.
- **P3a-7 SMS-pumping defences:** OTP requests are restricted to allowed country prefixes, capped at a global daily budget, and (optionally) gated behind a Cloudflare Turnstile check on the frontend.

### 10.1 Enabling two-step for an admin (once per admin phone)

1. Sign in with the admin number as usual (phone OTP).
2. Admin Dashboard → **Security** tab → **Enable two-step**.
3. Scan the QR with any authenticator app (Google Authenticator, Authy, etc.) — the secret is also shown as text if scanning fails.
4. Enter the 6-digit code the app shows → **Activate**.
5. **Save the 8 recovery codes.** They are shown exactly once, in this screen only. Print them or store them offline. Each code works once and is never recoverable (only hashes are stored).

After this, every future sign-in with that number shows a "Two-step code" step after the phone OTP. Admin endpoints keep working in the already-authenticated session; two-step is a sign-in gate, not a per-request prompt.

**Turning it off:** Security tab → **Turn off two-step** — requires a live code from the authenticator app. Recovery codes do not disable two-step; they only complete a sign-in.

**New-device alert:** the first sign-in from a browser the server hasn't seen (tracked by an httpOnly device cookie, up to 10 remembered devices) writes an `admin_new_device` audit row and sends an SMS alert to the admin. Until #52 (SendPK) is live, outbound SMS is console-only, so the alert appears in the server logs — the audit row in Admin → Audit is the reliable signal meanwhile.

### 10.2 Lockout recovery (forgot the authenticator AND the codes)

If an admin loses the authenticator app and the recovery codes, the two-step gate can only be cleared with this flag:

1. In Render: Environment → add `ADMIN_TOTP_RESET` = `true`.
2. Deploy once. The boot log shows an `admin_totp_reset` audit row; all admin two-step state (secrets, recovery hashes, remembered devices) is wiped.
3. **Immediately** set `ADMIN_TOTP_RESET` back to `false` (or delete the var) and redeploy.
4. Sign in with the phone OTP only, then re-enroll in the Security tab (10.1) and save the new codes.

The flag runs at most once per process, so a stray `true` left in env keeps wiping state on **every deploy** — that is why step 3 must not be skipped. The audit trail (`admin_totp_reset`) records each wipe.

### 10.3 SMS-pumping defences in production

- **Allow-list:** `SMS_ALLOWED_PREFIXES` (default `+92`) — OTP requests for numbers not matching any prefix are refused (429) and never reach the provider. Add prefixes comma-separated for multi-country deployments.
- **Daily cap:** `SMS_GLOBAL_DAILY_CAP` (default 200) counts every delivered SMS per UTC day; past it, new sends are refused. Spend alerts at 70% and 100% go to the logs and audit. The `console` provider is never capped (dev only), so this only has teeth once a live provider is configured.
- **Turnstile (optional):** set both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` to put a Cloudflare Turnstile challenge in front of the bot-walled forms (donor SOS, requester flows, contact requests, chat). Absent keys = the check is a silent no-op; the keys are exposed in `/api/config/public` so the UI knows whether to show the widget.

---

## 11. Honest caveats (unchanged)

- Load-test numbers in LOAD-TEST-REPORT.md describe the dev server (in-memory DB, one source IP, relaxed dev limits) — not production capacity on Atlas. Re-run `node loadtest/run-loadtest.mjs all` against the production URL after deploy.
- The MongoDB path is code-inspected + covered by the gated integration test above, but has never run against a real Atlas cluster as of this writing.
- SMS/Gemini production providers are stub-tested only; first real deployments must smoke-test them (§9 items 5, 6).
- Dev rate limits are relaxed versus production; production strictness engages via `NODE_ENV=production` automatically.
