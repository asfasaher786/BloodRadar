import { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAMES, Role, verifyAccessToken } from "../lib/tokens";

// Authentication middleware. The identity in req.auth comes ONLY from a
// signed JWT — never from the request body. Routes that previously trusted
// a client-supplied phone number are being migrated to use this instead.

export interface AuthInfo {
  /** canonical phone number (the donor identity) */
  sub: string;
  phone?: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Accept the access token as a Bearer header (API clients) or from the
  // httpOnly cookie (browser). Cookie wins convenience, header wins
  // explicitness — either is cryptographically equivalent here.
  let token: string | null = null;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length).trim();
  }
  if (!token && req.cookies) {
    token = req.cookies[AUTH_COOKIE_NAMES.access] || null;
  }

  if (!token) {
    res.status(401).json({ error: "Authentication required. Please log in." });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    return;
  }

  req.auth = { sub: payload.sub, phone: payload.phone, role: payload.role };
  next();
}

// Optional variant: attaches req.auth when a valid token is present but
// never blocks. Used by routes that serve both anonymous requesters (proven
// by a requester code) and signed-in staff (proven by role).
export function optionalAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  let token: string | null = null;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length).trim();
  }
  if (!token && req.cookies) {
    token = req.cookies[AUTH_COOKIE_NAMES.access] || null;
  }

  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.auth = { sub: payload.sub, phone: payload.phone, role: payload.role };
    }
  }
  next();
}

// Role gate. Usage: router.delete("/x", roleMiddleware("admin"), handler)
export function roleMiddleware(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: "Authentication required. Please log in." });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}
