import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import { NOTIFICATION_KINDS, type NotificationItem } from "@/lib/notifications";
import type { NotificationKind } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type BellData = { items: NotificationItem[]; unread: number; canDecide: boolean };

export async function loadBell(session: SessionContext): Promise<BellData> {
  const supabase = await createClient();
  const [{ data }, { count }] = await Promise.all([
    supabase.from("notifications").select("id, kind, params, link, read_at, created_at").eq("user_id", session.userId).eq("organization_id", session.organization.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", session.userId).eq("organization_id", session.organization.id).is("read_at", null),
  ]);
  return {
    items: (data ?? []).map((n) => ({ id: n.id, kind: n.kind, params: (n.params ?? {}) as Record<string, unknown>, link: n.link, read: !!n.read_at, created_at: n.created_at })),
    unread: count ?? 0,
    canDecide: can(session, "approvals.decide"),
  };
}

export type PrefsData = { prefs: { kind: NotificationKind; in_app: boolean; whatsapp: boolean }[]; phone: string | null };

export async function loadNotificationPrefs(session: SessionContext): Promise<PrefsData> {
  const supabase = await createClient();
  const { data } = await supabase.from("notification_preferences").select("kind, in_app, whatsapp").eq("user_id", session.userId).eq("organization_id", session.organization.id);
  const byKind = new Map((data ?? []).map((p) => [p.kind, p]));
  return {
    prefs: NOTIFICATION_KINDS.map((k) => byKind.get(k) ?? { kind: k, in_app: true, whatsapp: false }),
    phone: session.phone,
  };
}
