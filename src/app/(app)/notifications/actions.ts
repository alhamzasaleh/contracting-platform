"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { getSession } from "@/lib/auth/session";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
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
    .object({ prefs: z.array(z.object({ kind: z.enum(NOTIFICATION_KINDS as [string, ...string[]]), in_app: z.boolean(), whatsapp: z.boolean() }).strict()).max(20) })
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
