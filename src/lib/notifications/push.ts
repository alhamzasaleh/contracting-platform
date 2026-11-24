import "server-only";
import webpush from "web-push";
import { whatsappText } from "@/lib/notifications";
import { PUSH_ENDPOINT } from "@/lib/notifications/endpoint";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NotificationKind } from "@/lib/supabase/database.types";

/**
 * Push notifications to the user's devices (Web Push, works on the installed app
 * on iPad/iPhone and on Android/desktop browsers). The server key pair is created
 * once and kept in the database (service role only) — nothing for the owner to set up.
 */

/** Browsers' own push services only (shared with the sign-out route, see endpoint.ts). */
export { PUSH_ENDPOINT };

// Apple requires a real https/mailto contact for the sender
const SUBJECT = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://vercel.app";

type Keys = { public_key: string; private_key: string };
let cached: Keys | null = null;

async function vapidKeys(): Promise<Keys | null> {
  if (cached) return cached;
  try {
    const admin = createAdminClient();
    const { data } = await admin.rpc("push_vapid_keys", {});
    let keys = data as Keys | null;
    if (!keys) {
      const fresh = webpush.generateVAPIDKeys();
      const { data: stored } = await admin.rpc("push_vapid_keys", { p_public: fresh.publicKey, p_private: fresh.privateKey });
      keys = stored as Keys | null;
    }
    cached = keys;
    return keys;
  } catch {
    console.error("[push] keys unavailable");
    return null;
  }
}

/** The public key the browser needs to subscribe (safe to show). */
export async function pushPublicKey(): Promise<string | null> {
  return (await vapidKeys())?.public_key ?? null;
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; failures: number };
type Payload = { title: string; body: string; url: string; tag?: string };

async function sendTo(subs: Sub[], payload: Payload): Promise<number> {
  const keys = await vapidKeys();
  if (!keys) return 0;
  const admin = createAdminClient();
  let sent = 0;
  for (const s of subs) {
    if (!PUSH_ENDPOINT.test(s.endpoint)) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: SUBJECT, publicKey: keys.public_key, privateKey: keys.private_key },
        TTL: 60 * 60 * 24,
        timeout: 8000,
      });
      sent++;
      await admin.from("push_subscriptions").update({ failures: 0, last_success_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // 404/410: the device unsubscribed or the app was removed — forget it
      if (status === 404 || status === 410 || s.failures + 1 >= 10) await admin.from("push_subscriptions").delete().eq("id", s.id);
      else await admin.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
    }
  }
  return sent;
}

/** Only links inside the app (the bell's links are always relative). */
const safeUrl = (link: string | null) => (link && /^\/[A-Za-z0-9/_?=&%.-]*$/.test(link) && !link.startsWith("//") ? link : "/");

/** Send queued push deliveries (after an event, and by the daily job). */
export async function flushPush(limit = 30): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: queue } = await admin
      .from("notification_deliveries")
      .select("id, user_id, attempts, notification_id")
      .eq("channel", "push")
      .eq("status", "queued")
      .lt("attempts", 5)
      .order("created_at")
      .limit(limit);
    if (!queue?.length) return;
    const orgName = new Map<string, string>();
    const titleFor = async (org: string) => {
      if (!orgName.has(org)) {
        const { data } = await admin.from("organizations").select("name").eq("id", org).maybeSingle();
        orgName.set(org, data?.name ?? "");
      }
      return orgName.get(org) ?? "";
    };
    for (const d of queue) {
      const [{ data: n }, { data: subs }] = await Promise.all([
        admin.from("notifications").select("kind, params, link, organization_id").eq("id", d.notification_id).maybeSingle(),
        admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, failures, organization_id").eq("user_id", d.user_id ?? ""),
      ]);
      const mine = (subs ?? []).filter((s) => n && s.organization_id === n.organization_id);
      if (!n || !mine.length) {
        await admin.from("notification_deliveries").update({ status: "failed", attempts: d.attempts + 1, last_error: "no device" }).eq("id", d.id);
        continue;
      }
      const sent = await sendTo(mine, {
        title: await titleFor(n.organization_id),
        body: whatsappText(n.kind as NotificationKind, (n.params ?? {}) as Record<string, unknown>),
        url: safeUrl(n.link),
        tag: d.notification_id,
      });
      await admin
        .from("notification_deliveries")
        .update(sent > 0 ? { status: "sent", sent_at: new Date().toISOString(), attempts: d.attempts + 1 } : { status: d.attempts + 1 >= 5 ? "failed" : "queued", attempts: d.attempts + 1, last_error: "push failed" })
        .eq("id", d.id);
    }
  } catch {
    console.error("[push] flush failed");
  }
}

/** A test notification to the signed-in user's own devices. */
export async function sendTestPush(userId: string, orgId: string, body: string): Promise<number> {
  const admin = createAdminClient();
  const [{ data: subs }, { data: org }] = await Promise.all([
    admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("user_id", userId).eq("organization_id", orgId),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  return sendTo(subs ?? [], { title: org?.name ?? "", body, url: "/settings/notifications", tag: "test" });
}
