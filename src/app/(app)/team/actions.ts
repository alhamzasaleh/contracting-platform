"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { num, optionalDate, optionalNum, optionalText } from "@/lib/validation/numbers";
import { normalizeSaudiMobile } from "@/lib/validation/phone";

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

const digits = (v: unknown) =>
  typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s+/g, "").toUpperCase() : v;

const employeeSchema = z
  .object({
    id: z.uuid().optional(),
    full_name: z.string().trim().min(2, "required").max(120),
    is_saudi: z.boolean(),
    nationality: optionalText(60),
    job_title: optionalText(80),
    phone: z.preprocess(
      (v) => (typeof v === "string" && v.trim() ? normalizeSaudiMobile(v) ?? "invalid" : null),
      z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable(),
    ),
    id_number: z.preprocess((v) => (v === "" ? null : digits(v)), z.string().regex(/^\d{10}$/, "idInvalid").nullable()),
    id_expiry: optionalDate,
    passport_expiry: optionalDate,
    insurance_expiry: optionalDate,
    start_date: optionalDate,
    basic_salary: num({ min: 0, max: 1_000_000 }),
    housing_allowance: num({ min: 0, max: 1_000_000 }),
    transport_allowance: num({ min: 0, max: 1_000_000 }),
    other_allowances: num({ min: 0, max: 1_000_000 }),
    iban: z.preprocess((v) => (v === "" ? null : digits(v)), z.string().regex(/^SA\d{22}$/, "ibanInvalid").nullable()),
    status: z.enum(["active", "on_leave", "final_exit"]),
    notes: optionalText(1000),
  })
  .strict();

export async function saveEmployee(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id, ...data } = parsed.data;
  const { error } = id
    ? await c.supabase.from("employees").update(data).eq("id", id).eq("organization_id", c.orgId)
    : await c.supabase.from("employees").insert({ ...data, organization_id: c.orgId });
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
