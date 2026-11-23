import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks signature check (used by Supabase Auth hooks):
 * signature = base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), header
 * "webhook-signature: v1,<sig> [v1,<sig2> …]"; the secret is "v1,whsec_<base64>".
 * Requests older/newer than 5 minutes are refused (replay protection).
 */
export function verifyWebhook(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, now = Date.now()): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const raw = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return false;
  }
  if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
