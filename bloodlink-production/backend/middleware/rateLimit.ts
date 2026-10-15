import rateLimit, { RateLimitRequestHandler } from "express-rate-limit";

// Rate limiting tiers. Master-prompt rule: strictest limits on SOS, OTP and
// login paths — the endpoints a spammer or scraper would target first.
// Limits are per-IP (app.ts sets trust proxy so Render's proxy IP is not
// what gets counted).

export interface RateLimiters {
  globalApi: RateLimitRequestHandler;
  otpRequest: RateLimitRequestHandler;
  otpVerify: RateLimitRequestHandler;
  sos: RateLimitRequestHandler;
  chat: RateLimitRequestHandler;
}

function json429(message: string) {
  return (_req: any, res: any) => {
    res.status(429).json({ error: message });
  };
}

// Factory (not module-level instances) so every createApp() — including
// test suites — gets fresh counters and tests never contaminate each other.
export function createRateLimiters(): RateLimiters {
  return {
    globalApi: rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      // SSE clients hold a connection open and reconnect aggressively when
      // interrupted — counting those against the API budget punishes normal
      // usage. Health probes are similarly exempt.
      skip: (req) => req.url === "/api/events" || req.url === "/health",
      handler: json429("Too many requests. Please try again in a few minutes."),
    }),
    otpRequest: rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 5,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: json429("Too many code requests from this device. Please try again later."),
    }),
    otpVerify: rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: json429("Too many verification attempts from this device. Please try again later."),
    }),
    sos: rateLimit({
      windowMs: 10 * 60 * 1000,
      limit: 5,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: json429("SOS limit reached. If this is a real emergency, call the hospital directly."),
    }),
    chat: rateLimit({
      windowMs: 5 * 60 * 1000,
      limit: 30,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: json429("You're chatting too fast. Please wait a moment."),
    }),
  };
}
