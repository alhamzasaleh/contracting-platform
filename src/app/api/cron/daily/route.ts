import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { whatsappText } from "@/lib/notifications";
import { sendWhatsApp, whatsappConfigured } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationKind } from "@/lib/supabase/database.types";

/**
 * Daily job (Vercel Cron, see vercel.json): reminders (late payments, expiring
 * documents, pending approvals) + WhatsApp delivery of queued notifications.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
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

  let sent = 0;
  let failed = 0;
  if (whatsappConfigured()) {
    const { data: queue } = await admin.from("notification_deliveries").select("id, phone, attempts, notification_id").eq("status", "queued").lt("attempts", 5).order("created_at").limit(200);
    for (const d of queue ?? []) {
      const { data: n } = await admin.from("notifications").select("kind, params").eq("id", d.notification_id).maybeSingle();
      if (!n) continue;
      const r = await sendWhatsApp(d.phone, whatsappText(n.kind as NotificationKind, (n.params ?? {}) as Record<string, unknown>));
      if (r.ok) sent++;
      else failed++;
      await admin
        .from("notification_deliveries")
        .update(r.ok ? { status: "sent", sent_at: new Date().toISOString(), attempts: d.attempts + 1 } : { status: d.attempts + 1 >= 5 ? "failed" : "queued", attempts: d.attempts + 1, last_error: r.error })
        .eq("id", d.id);
    }
  }
  return NextResponse.json({ reminders: reminders ?? 0, whatsapp: { configured: whatsappConfigured(), sent, failed } });
}
