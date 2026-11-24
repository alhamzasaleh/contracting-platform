import { z } from "zod";

/** Browsers' own push services only (the database enforces the same list). */
export const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

const signOutBody = z.object({ endpoint: z.string().max(1000).regex(PUSH_ENDPOINT) }).strict();

/** The push endpoint the app sends on sign-out (this device's subscription), or null. */
export function signOutEndpoint(body: unknown): string | null {
  const parsed = signOutBody.safeParse(body);
  return parsed.success ? parsed.data.endpoint : null;
}
