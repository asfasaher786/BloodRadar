import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createApp } from "./app";
import { CONFIG } from "./config/config";
import { logger } from "./lib/logger";
import { startReminderJob } from "./jobs/reminderJob";

// Boot entry: builds the app from backend/app.ts, mounts frontend serving
// (Vite dev middleware or the built dist/), then listens. Only this file
// knows about listening — tests import createApp directly instead.
const app = createApp();

async function start() {
  if (CONFIG.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(CONFIG.PORT, "0.0.0.0", () => {
    logger.info(`BloodRadar server listening on port ${CONFIG.PORT} (${CONFIG.NODE_ENV}, db=${CONFIG.MONGO_URI ? "mongodb" : "fallback"}, sms=${CONFIG.SMS_PROVIDER})`);
  });

  // Background jobs (env-gated).
  startReminderJob();

  // Graceful shutdown: stop accepting connections, let in-flight requests
  // finish, then exit. Hard-exit fallback so a stuck handle can't hang
  // Render deployments forever.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((err) => {
  logger.error({ err }, "Server boot failed");
  process.exit(1);
});
