import { createHash, randomBytes } from "node:crypto";

/**
 * Client-page link token (`/p/<contract number>/<token>`). New links use 12 random bytes =
 * 16 base64url characters (short enough for a WhatsApp message; guessing is bounded by the
 * per-IP rate limits). Older links have 43 characters and stay valid. Only the SHA-256 of a
 * token is stored. The database applies the same 16..100 rule (`private.portal_token_ok`).
 */
export const PORTAL_TOKEN_BYTES = 12;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,100}$/;

export function newPortalToken(): string {
  return randomBytes(PORTAL_TOKEN_BYTES).toString("base64url");
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
