import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Setup check: which settings are present (booleans only, never values) and
 * whether the server reaches the database. Public answers are ok/missing only;
 * details (error codes) need `Authorization: Bearer $CRON_SECRET`. Rate-limited.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const detailed = !!secret && auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));

  const configured = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    secretKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
    supabaseUrlHasPath: (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").pathname.replace(/\/$/, "") !== "";
      } catch {
        return null;
      }
    })(),
  };

  let database = "not checked";
  if (configured.supabaseUrl && configured.secretKey) {
    try {
      const rl = await rateLimit(`health:${await clientIp()}`, 20, 60);
      if (rl === "limited") return new NextResponse("Too many requests", { status: 429 });
      database = rl === "ok" ? "ok" : "error";
    } catch (e) {
      database = detailed ? `error: ${(e as Error).message}` : "error";
    }
  }
  return NextResponse.json({ configured, database }, { headers: { "Cache-Control": "no-store" } });
}
