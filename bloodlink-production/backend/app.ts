import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { CONFIG } from "./config/config";
import { httpLogger, logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { createRateLimiters } from "./middleware/rateLimit";
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

// The Express app is built by a factory so tests (supertest) can import it
// without starting a listener or mounting the Vite dev middleware. The
// real boot path (server.ts) mounts Vite/static serving on top and listens.
export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Behind Render/nginx proxies; required so rate limiters key off real IPs.
  app.set("trust proxy", 1);

  // Security headers. CSP is handled at the Vite/static layer so dev HMR
  // keeps working; everything else (X-Content-Type-Options, frameguard,
  // nosniff, DNS prefetch control...) is on.
  app.use(helmet({ contentSecurityPolicy: false }));

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
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }));

  // 100kb body cap — nobody legitimately posts more than that here.
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Rate limiting: a generous global tier, then strict tiers on the paths
  // an abuser would target first (SOS spam, OTP abuse, Gemini cost abuse).
  const limiters = createRateLimiters();
  app.use("/api", limiters.globalApi);
  app.use("/api/auth/otp/request", limiters.otpRequest);
  app.use("/api/auth/otp/verify", limiters.otpVerify);
  app.post("/api/emergencies", limiters.sos);
  app.post("/api/chat", limiters.chat);

  // Health with real DB status (the master prompt requires db status here).
  app.get("/health", async (_req, res) => {
    try {
      const { mode } = await getDb();
      res.json({
        status: "ok",
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
  app.use("/api/ml", mlRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/sms", smsRoutes);
  app.use("/api/stats", statsRoutes);
  app.use("/api/admin", adminRoutes);

  // Live event stream (SSE). PII-free by contract — see services/events.ts.
  app.get("/api/events", (_req, res) => {
    registerSseClient(res);
  });

  // Unknown API paths get JSON 404 (never the SPA HTML shell).
  app.use("/api", notFoundHandler);

  // Central error handler — consistent { error } JSON everywhere.
  app.use(errorHandler);

  return app;
}
