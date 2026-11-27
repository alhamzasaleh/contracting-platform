"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { num, optionalNum } from "@/lib/validation/numbers";
import { employeeSchema } from "@/lib/hr/employee-schema";

async function ctx() {
  const session = await getSession();
  if (!can(session, "hr.manage")) return null;
  return { orgId: session.organization.id, supabase: await createClient() };
}

function dbError(error: { code?: string; message: string } | null): ActionResult | null {
  if (!error) return null;
  if (error.code === "23505") return { ok: false, error: "duplicate" };
  if (error.code === "42501") return { ok: false, error: "noAccess" };
  if (error.code === "23514") return { ok: false, error: "invalid" };
  console.error("[hr] db error", { code: error.code });
  return { ok: false, error: "error" };
}

const done = (): ActionResult => {
  revalidatePath("/team", "layout");
  return { ok: true };
};

export async function saveEmployee(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id, ...data } = parsed.data;
  const { error } = id
    ? await c.supabase.from("employees").update(data).eq("id", id).eq("organization_id", c.orgId)
    : await c.supabase.from("employees").insert({ ...data, organization_id: c.orgId });
  // the database's own rule (an employee always has a phone): shown on the phone field
  if (error?.message.includes("employee phone required")) return { ok: false, error: "invalid", fieldErrors: { phone: "required" } };
  return dbError(error) ?? done();
}

export async function seedCostItems(): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const { error } = await c.supabase.rpc("seed_employee_cost_items", { p_org: c.orgId });
  return dbError(error) ?? done();
}

const costItemSchema = z
  .object({
    id: z.uuid(),
    value: num({ min: 0, max: 10_000_000 }),
    amortize_months: optionalNum({ min: 1, max: 120 }),
    is_active: z.boolean(),
    is_provision: z.boolean(),
    mark_reviewed: z.boolean(),
  })
  .strict();

export async function saveCostItem(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = costItemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id, mark_reviewed, ...data } = parsed.data;
  const { error } = await c.supabase
    .from("employee_cost_items")
    .update({ ...data, ...(mark_reviewed ? { last_reviewed_at: new Date().toISOString().slice(0, 10) } : {}) })
    .eq("id", id)
    .eq("organization_id", c.orgId);
  return dbError(error) ?? done();
}
