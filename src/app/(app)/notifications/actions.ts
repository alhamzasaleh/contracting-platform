"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { getSession } from "@/lib/auth/session";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { PUSH_ENDPOINT, sendTestPush } from "@/lib/notifications/push";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/** Mark one notification (or all of mine) as read. RLS keeps it to the user's own. */
export async function markNotificationsRead(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z.object({ id: z.uuid().optional() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", session.userId).is("read_at", null);
  if (parsed.data.id) q = q.eq("id", parsed.data.id);
  const { error } = await q;
  if (error) {
    console.error("[notifications] mark read failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Which notifications this user wants, and where (in the app / WhatsApp). */
export async function saveNotificationPrefs(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z
    .object({ prefs: z.array(z.object({ kind: z.enum(NOTIFICATION_KINDS as [string, ...string[]]), in_app: z.boolean(), whatsapp: z.boolean(), push: z.boolean() }).strict()).max(30) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const rows = parsed.data.prefs.map((p) => ({ ...p, kind: p.kind as (typeof NOTIFICATION_KINDS)[number], organization_id: session.organization.id, user_id: session.userId, updated_at: new Date().toISOString() }));
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "organization_id,user_id,kind" });
  if (error) {
    console.error("[notifications] prefs failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  return { ok: true };
}

const b64url = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`));
const subscriptionSchema = z
  .object({
    endpoint: z.string().max(1000).regex(PUSH_ENDPOINT),
    keys: z.object({ p256dh: b64url(80, 100), auth: b64url(16, 32) }).strict(),
    device: z.string().max(120).optional(),
  })
  .strict();

/** Turn on notifications for this device (the browser's push subscription). */
export async function savePushSubscription(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { endpoint, keys, device } = parsed.data;
  // the same device may re-subscribe (new keys): replace its own row
  await supabase.from("push_subscriptions").delete().eq("user_id", session.userId).eq("endpoint", endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({
    organization_id: session.organization.id, user_id: session.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, device: device ?? null,
  });
  if (error) {
    console.error("[push] subscribe failed", { code: error.code });
    return { ok: false, error: error.code === "23505" ? "invalid" : "error" };
  }
  revalidatePath("/settings/notifications");
  return { ok: true };
}

/** Turn off notifications for this device. */
export async function removePushSubscription(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z.object({ endpoint: z.string().max(1000) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", session.userId).eq("endpoint", parsed.data.endpoint);
  if (error) return { ok: false, error: "error" };
  revalidatePath("/settings/notifications");
  return { ok: true };
}

/** Send a test notification to my own devices (5 per hour). */
export async function sendPushTest(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z.object({ text: z.string().min(1).max(120) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if ((await rateLimit(`push-test:${session.userId}`, 5, 3600)) !== "ok") return { ok: false, error: "rate" };
  const sent = await sendTestPush(session.userId, session.organization.id, parsed.data.text);
  return sent > 0 ? { ok: true } : { ok: false, error: "error" };
}
