import jwt from "jsonwebtoken";
import { CONFIG } from "../config/config";

export type Role = "donor" | "hospital_staff" | "ngo" | "admin";

export interface AccessTokenPayload {
  sub: string; // canonical phone number (donor identity) or user id
  phone?: string;
  role: Role;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  role: Role;
  type: "refresh";
}

export function signAccessToken(payload: { sub: string; phone?: string; role: Role }): string {
  const tokenPayload: AccessTokenPayload = { sub: payload.sub, role: payload.role, type: "access" };
  if (payload.phone) tokenPayload.phone = payload.phone;
  return jwt.sign(tokenPayload, CONFIG.JWT_SECRET, { expiresIn: CONFIG.ACCESS_TOKEN_TTL_SECONDS });
}

export function signRefreshToken(payload: { sub: string; role: Role }): string {
  const tokenPayload: RefreshTokenPayload = { sub: payload.sub, role: payload.role, type: "refresh" };
  return jwt.sign(tokenPayload, CONFIG.JWT_SECRET, { expiresIn: CONFIG.REFRESH_TOKEN_TTL_SECONDS });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as AccessTokenPayload;
    if (decoded.type !== "access") return null;
    return decoded;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, CONFIG.JWT_SECRET) as RefreshTokenPayload;
    if (decoded.type !== "refresh") return null;
    return decoded;
  } catch {
    return null;
  }
}

export const AUTH_COOKIE_NAMES = {
  access: "br_access",
  refresh: "br_refresh",
} as const;

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: CONFIG.IS_PROD, // https-only in production
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  };
}
