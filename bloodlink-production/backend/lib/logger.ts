import pino, { type Logger, type DestinationStream } from "pino";
import pinoHttp from "pino-http";
import { CONFIG } from "../config/config";

// Structured logging with PII redaction. Master-prompt rules encoded here:
// OTPs and full phone numbers are NEVER logged — the redaction list applies
// in every environment, so a dev-only habit can't leak into production by
// accident. Anything matching these key names is replaced with [REDACTED].

// fast-redact path semantics: "*.key" matches only ONE level of nesting and
// misses top-level keys, and "**" is unsupported — so every PII key is listed
// twice: bare (top level, the shape we actually log: { phone, smsBody }) and
// "*." prefixed (one level deep). Verified by logRedaction.test.ts.
const PII_KEYS = [
  "phone",
  "contactPhone",
  "requesterPhone",
  "donorPhone",
  "senderPhone",
  "to",
  "body",
  "smsBody",
  "token",
  "accessToken",
  "refreshToken",
  "otp",
  "code",
  "password",
  "authorization",
];

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  ...PII_KEYS,
  ...PII_KEYS.map((key) => `*.${key}`),
];

// Factory so tests can point a logger at a captured stream and assert the
// redaction behaviour directly, instead of trusting the config by eye.
export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {}
): Logger {
  return pino(
    {
      level: options.level ?? "info",
      base: { service: "bloodradar" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
    options.destination
  );
}

export const logger = createLogger({
  level: CONFIG.IS_TEST ? "silent" : process.env.LOG_LEVEL || "info",
});

// Request logging middleware. Bodies are never logged (pino-http default),
// and /health is skipped so uptime probes don't spam the log stream.
export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === "/health",
  },
});
