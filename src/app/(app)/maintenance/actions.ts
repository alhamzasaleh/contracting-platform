"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { runBackground } from "@/lib/background";
import { NUMBER_RE } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

const updateSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(["open", "in_progress", "resolved", "closed", "rejected"]),
    assigned_to: z.uuid().nullable(),
    covered: z.boolean(),
    cost: z.number().min(0).max(1_000_000),
    reply: z.string().trim().max(1000).nullable(),
    internal_note: z.string().trim().max(2000).nullable(),
  })
  .strict();

/** Staff update a maintenance request (status, assignee, cost, reply to the client, internal note). */
export async function updateMaintenance(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "projects.manage")) return { ok: false, error: "noAccess" };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id, ...v } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("maintenance_requests")
    .update({ ...v, reply: v.reply || null, internal_note: v.internal_note || null })
    .eq("id", id)
    .eq("organization_id", session.organization.id);
  if (error) {
    console.error("[maintenance] update failed", { code: error.code });
    return { ok: false, error: error.code === "22023" ? "invalid" : "error" };
  }
  after(runBackground);
  revalidatePath("/maintenance");
  return { ok: true };
}

/** Staff log a request on the client's behalf (e.g. a phone call). */
export async function createMaintenance(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "projects.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ contract: z.string().regex(NUMBER_RE), body: z.string().trim().min(1).max(2000) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts").select("id").eq("organization_id", session.organization.id).eq("number", parsed.data.contract).maybeSingle();
  if (!c) return { ok: false, error: "invalid" };
  const { error } = await supabase.from("maintenance_requests").insert({ organization_id: session.organization.id, contract_id: c.id, body: parsed.data.body });
  if (error) {
    console.error("[maintenance] create failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  revalidatePath("/maintenance");
  return { ok: true };
}
