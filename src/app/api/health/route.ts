import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Setup check: which settings are present (booleans only, never values)
 * and whether the server can reach the database. No personal data.
 */
export async function GET() {
  const configured = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    secretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    secretKeyFormat: process.env.SUPABASE_SECRET_KEY?.startsWith("sb_secret_")
      ? "sb_secret"
      : process.env.SUPABASE_SECRET_KEY
        ? "other"
        : "missing",
    siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
  };

  let database = "not checked";
  if (configured.supabaseUrl && configured.secretKey) {
    try {
      const { error } = await createAdminClient().rpc("check_rate_limit", {
        p_key: "health:check",
        p_max: 1_000_000,
        p_window_seconds: 60,
      });
      database = error ? `error ${error.code ?? ""}: ${error.message}` : "ok";
    } catch (e) {
      database = `error: ${(e as Error).message}`;
    }
  }

  return NextResponse.json({ configured, database }, { headers: { "Cache-Control": "no-store" } });
}
