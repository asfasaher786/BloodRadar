import pino from "pino";
import pinoHttp from "pino-http";
import { CONFIG } from "../config/config";

// Structured logging with PII redaction. Master-prompt rules encoded here:
// OTPs and full phone numbers are NEVER logged — the redaction list applies
// in every environment, so a dev-only habit can't leak into production by
// accident. Anything matching these key names is replaced with [REDACTED].

export const logger = pino({
  level: CONFIG.IS_TEST ? "silent" : process.env.LOG_LEVEL || "info",
  base: { service: "bloodradar" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      "*.phone",
      "*.contactPhone",
      "*.requesterPhone",
      "*.donorPhone",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.otp",
      "*.code",
      "*.password",
      "*.authorization",
    ],
    censor: "[REDACTED]",
  },
});

// Request logging middleware. Bodies are never logged (pino-http default),
// and /health is skipped so uptime probes don't spam the log stream.
export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
});
