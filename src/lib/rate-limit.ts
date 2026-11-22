import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitResult = "ok" | "limited" | "unavailable";

/**
 * Fixed-window rate limit backed by Postgres. If the check itself fails
 * (database unreachable, misconfigured key) the request is refused as
 * "unavailable" — never silently allowed — and the cause is logged
 * without personal data.
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] check failed", { code: error.code, message: error.message, hint: error.hint });
      return "unavailable";
    }
    return data === true ? "ok" : "limited";
  } catch (e) {
    console.error("[rate-limit] check threw", { message: (e as Error).message });
    return "unavailable";
  }
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
