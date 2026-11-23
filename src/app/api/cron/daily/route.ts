import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { flushWhatsApp } from "@/lib/notifications/flush";
import { flushPush } from "@/lib/notifications/push";
import { runQoyodSync } from "@/lib/qoyod/sync";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily job (Vercel Cron, see vercel.json): reminders (late payments, expiring
 * documents, pending approvals, project delays / budget / losses / missed visits), queued push and WhatsApp messages and the Qoyod queue.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const admin = createAdminClient();
  const { data: reminders, error } = await admin.rpc("run_daily_reminders");
  if (error) console.error("[cron] reminders failed", { code: error.code });
  await Promise.allSettled([flushWhatsApp(200), flushPush(200)]);
  const qoyod = await runQoyodSync(50);
  return NextResponse.json({ reminders: reminders ?? 0, qoyod });
}
