import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

// Central error handling — the single place that converts thrown errors into
// client-visible JSON. Every error body has the same shape:
//   { error: "human-readable message" }
// 5xx responses never leak internal details (stack traces, DB errors) to the
// client; they are logged server-side instead.

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Endpoint not found" });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  // body-parser signals oversized payloads with type "entity.too.large"
  const status = err?.status || (err?.type === "entity.too.large" ? 413 : 500);

  if (status >= 500) {
    logger.error({ err: err?.message || String(err) }, "Unhandled error");
  }

  res.status(status).json({
    error: status >= 500
      ? "Something went wrong on our side. Please try again."
      : err?.message || "Request failed",
  });
}
