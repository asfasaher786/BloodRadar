import express from "express";
import cors from "cors";
import crypto from "crypto";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { CONFIG } from "./config/config";
import { httpLogger, logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { createRateLimiters } from "./middleware/rateLimit";
import { authMiddleware, roleMiddleware } from "./middleware/auth";
import { getDb } from "./services/dbService";
import { registerSseClient } from "./services/events";
import authRoutes from "./routes/authRoutes";
import donorRoutes from "./routes/donorRoutes";
import hospitalRoutes from "./routes/hospitalRoutes";
import campRoutes from "./routes/campRoutes";
import emergencyRoutes from "./routes/emergencyRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import mlRoutes from "./routes/mlRoutes";
import chatRoutes from "./routes/chatRoutes";
import smsRoutes from "./routes/smsRoutes";
import statsRoutes from "./routes/statsRoutes";
import adminRoutes from "./routes/adminRoutes";
import orgRoutes from "./routes/orgRoutes";
import requesterRoutes from "./routes/requesterRoutes";

// The Express app is built by a factory so tests (supertest) can import it
// without starting a listener or mounting the Vite dev middleware. The
// real boot path (server.ts) mounts Vite/static serving on top and listens.
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Behind Render/nginx proxies; required so rate limiters key off real IPs.
  app.set("trust proxy", 1);

  // Security headers. CSP is production-only: a strict policy would break
  // Vite dev HMR (ws: sockets, inline styles), which is why it's off in dev.
  // P3a-3: production gets a strict policy whose allow-list is exactly what
  // the app really uses — Google Fonts (design tokens load via css2) and
  // ArcGIS map tiles. Everything else is self-hosted, so everything else is
  // denied. script-src-attr 'none' also kills inline event handlers.
  // P3a-7: when Cloudflare Turnstile is configured, its script/iframe hosts
  // are added — and only then, so the disabled state keeps the tight policy.
  // (No upgrade-insecure-requests: the site is all-HTTPS in production and
  // browsers already block/upgrade mixed content; the directive would only
  // corrupt local prod-mode smoke tests.)
  const turnstileHosts = CONFIG.TURNSTILE_ENABLED
    ? ["https://challenges.cloudflare.com"]
    : [];
  const cspDirectives = CONFIG.IS_PROD
    ? {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...turnstileHosts],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https://services.arcgisonline.com"],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", ...turnstileHosts],
        frameSrc: turnstileHosts,
        workerSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      }
    : undefined;
  app.use(
    helmet({
      contentSecurityPolicy: cspDirectives
        ? { useDefaults: false, directives: cspDirectives }
        : false,
    })
  );

  // Structured request logging with PII redaction.
  app.use(httpLogger);

  // Strict CORS: only the configured frontend origin may call the API with
  // credentials. Local dev origins are allowed; no-origin requests (curl,
  // tests, server-to-server) are permitted because they can't carry a
  // browser session.
  const allowedOrigins = [
    CONFIG.FRONTEND_URL,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ].filter(Boolean) as string[];
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // Disallowed browser origins get a clean 403 (not a 500) and never
      // reach the routes. No-origin requests (curl, tests, server-to-server)
      // are allowed above because they can't carry a browser session.
      const err: any = new Error("Not allowed by CORS");
      err.status = 403;
      return callback(err);
    },
    credentials: true,
  }));

  // 100kb body cap — nobody legitimately posts more than that here.
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // P3a-8: anonymous device-id cookie. It lets us spot an admin sign-in
  // from a browser we've never seen (new-device alert) without identifying
  // the person. Random 128-bit value, httpOnly, one year — no PII, ever.
  app.use((req, res, next) => {
    if (!req.cookies?.br_devid) {
      res.cookie("br_devid", crypto.randomBytes(16).toString("hex"), {
        httpOnly: true,
        sameSite: "lax",
        secure: CONFIG.IS_PROD,
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: "/",
      });
    }
    next();
  });

  // Rate limiting: a generous global tier, then strict tiers on the paths
  // an abuser would target first (SOS spam, OTP abuse, Gemini cost abuse).
  const limiters = createRateLimiters();
  app.use("/api", limiters.globalApi);
  app.use("/api/auth/otp/request", limiters.otpRequest);
  app.use("/api/auth/otp/verify", limiters.otpVerify);
  app.use("/api/auth/totp/verify", limiters.totpVerify);
  app.use("/api/requester/otp/request", limiters.otpRequest);
  app.use("/api/requester/otp/verify", limiters.otpVerify);
  app.post("/api/emergencies", limiters.sos);
  app.post("/api/chat", limiters.chat);

  // Health with real DB status (the master prompt requires db status here).
  // P0-4: in production, running on the in-memory fallback is UNHEALTHY —
  // the probe reports 503 so Render's health check and uptime monitoring
  // see the truth instead of an "ok" backed by a store that resets on boot.
  app.get("/health", async (_req, res) => {
    try {
      const { mode } = await getDb();
      const dbOk = mode === "mongodb";
      const healthy = dbOk || !CONFIG.IS_PROD;
      res.status(healthy ? 200 : 503).json({
        status: dbOk ? "ok" : CONFIG.IS_PROD ? "unhealthy" : "ok",
        mode,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: CONFIG.NODE_ENV,
      });
    } catch (err) {
      logger.error({ err }, "Health check failed");
      res.status(503).json({ status: "degraded", error: "Database unreachable" });
    }
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/donors", donorRoutes);
  app.use("/api/hospitals", hospitalRoutes);
  app.use("/api/camps", campRoutes);
  app.use("/api/emergencies", emergencyRoutes);
  app.use("/api/notifications", notificationRoutes);
  // P3b-3: the ML/urgency lab is admin-only. It exposes aggregate emergency
  // statistics and donor-location clustering — operational telemetry the
  // public has no business seeing, and donor locations even less so.
  app.use("/api/ml", authMiddleware, roleMiddleware("admin"), mlRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/sms", smsRoutes);
  app.use("/api/stats", statsRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/orgs", orgRoutes);
  app.use("/api/requester", requesterRoutes);

  // Public, PII-free configuration the frontend needs before rendering
  // (P3a-7): whether the bot wall is on and which site key the widget uses.
  app.get("/api/config/public", (_req, res) => {
    res.json({
      turnstile: {
        enabled: CONFIG.TURNSTILE_ENABLED,
        siteKey: CONFIG.TURNSTILE_SITE_KEY,
      },
    });
  });

  // Live event stream (SSE). PII-free by contract — see services/events.ts.
  // P3a-4: capped per IP; excess connections get an honest 503 instead of
  // letting one client pin the server's connection budget open.
  app.get("/api/events", (req, res) => {
    if (!registerSseClient(res)) {
      res.status(503).json({
        error: "Too many open live connections from this device. Please close other BloodRadar tabs and reload.",
      });
      return;
    }
  });

  // Unknown API paths get JSON 404 (never the SPA HTML shell).
  app.use("/api", notFoundHandler);

  // Central error handler — consistent { error } JSON everywhere.
  app.use(errorHandler);

  return app;
}
