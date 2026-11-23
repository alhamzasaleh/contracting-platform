import "server-only";
import { clientMessageText, whatsappText } from "@/lib/notifications";
import { sendWhatsApp, whatsappConfigured } from "@/lib/notifications/whatsapp";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationKind } from "@/lib/supabase/database.types";

/**
 * Send queued WhatsApp notifications now (called with `after()` right after an
 * event, so the user never waits). The daily job retries anything left over.
 */
export async function flushWhatsApp(limit = 20): Promise<void> {
  if (!whatsappConfigured()) return;
  try {
    const admin = createAdminClient();
    const { data: queue } = await admin.from("notification_deliveries").select("id, phone, attempts, notification_id").eq("channel", "whatsapp").eq("status", "queued").lt("attempts", 5).order("created_at").limit(limit);
    for (const d of queue ?? []) {
      const { data: n } = await admin.from("notifications").select("kind, params").eq("id", d.notification_id).maybeSingle();
      if (!n) continue;
      if (!d.phone) continue;
      const r = await sendWhatsApp(d.phone, whatsappText(n.kind as NotificationKind, (n.params ?? {}) as Record<string, unknown>));
      await admin
        .from("notification_deliveries")
        .update(r.ok ? { status: "sent", sent_at: new Date().toISOString(), attempts: d.attempts + 1 } : { status: d.attempts + 1 >= 5 ? "failed" : "queued", attempts: d.attempts + 1, last_error: r.error })
        .eq("id", d.id);
    }
    // messages to clients (receipt issued, maintenance done)
    const { data: out } = await admin.from("client_messages").select("id, phone, attempts, kind, params").eq("status", "queued").lt("attempts", 5).order("created_at").limit(limit);
    for (const m of out ?? []) {
      const r = await sendWhatsApp(m.phone, clientMessageText(m.kind, (m.params ?? {}) as Record<string, unknown>));
      await admin
        .from("client_messages")
        .update(r.ok ? { status: "sent", sent_at: new Date().toISOString(), attempts: m.attempts + 1 } : { status: m.attempts + 1 >= 5 ? "failed" : "queued", attempts: m.attempts + 1, last_error: r.error })
        .eq("id", m.id);
    }
  } catch {
    console.error("[whatsapp] flush failed");
  }
}
