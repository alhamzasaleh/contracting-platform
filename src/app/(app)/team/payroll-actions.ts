"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { advancesTooHigh } from "@/lib/hr";
import { createClient } from "@/lib/supabase/server";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().min(0).max(10_000_000);

function fail(error: { code?: string } | null, what: string): ActionResult<never> {
  console.error(`[payroll] ${what} failed`, { code: error?.code });
  return { ok: false, error: error?.code === "42501" ? "noAccess" : "error" };
}
const done = (): ActionResult => {
  revalidatePath("/team", "layout");
  revalidatePath("/");
  return { ok: true };
};

async function ctx(perm: "hr.manage" | "pay" = "hr.manage") {
  const session = await getSession();
  const ok = perm === "pay" ? can(session, "hr.manage") || can(session, "finance.manage") : can(session, "hr.manage");
  return ok ? { supabase: await createClient(), orgId: session.organization.id } : null;
}

export async function createPayrollRun(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await c.supabase.rpc("create_payroll_run", { p_org: c.orgId, p_month: `${parsed.data.month}-01` });
  return error ? fail(error, "create run") : done();
}

export async function updatePayrollLine(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id, overtime: money, deductions: money, advances: money, note: z.string().trim().max(300).nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { id: lineId, ...row } = parsed.data;
  const { error } = await c.supabase.from("payroll_lines").update({ ...row, note: row.note || null }).eq("id", lineId).eq("organization_id", c.orgId);
  return error ? fail(error, "update line") : done();
}

export async function approvePayroll(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "hr.manage") || !can(session, "approvals.decide")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ run_id: id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payroll_run", { p_run: parsed.data.run_id });
  if (error && advancesTooHigh(error)) return { ok: false, error: "advancesExceedOpen" };
  return error ? fail(error, "approve") : done();
}

export async function markPayrollPaid(input: unknown): Promise<ActionResult> {
  const c = await ctx("pay");
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = z.object({ run_id: id, paid_on: day }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await c.supabase.rpc("mark_payroll_paid", { p_run: parsed.data.run_id, p_paid_on: parsed.data.paid_on });
  return error ? fail(error, "paid") : done();
}

export async function addAdvance(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = z.object({ employee_id: id, amount: z.number().positive().max(1_000_000), given_on: day, note: z.string().trim().max(300).nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await c.supabase.from("employee_advances").insert({ ...parsed.data, note: parsed.data.note || null, organization_id: c.orgId });
  return error ? fail(error, "advance") : done();
}

export async function deleteAdvance(input: unknown): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await c.supabase.from("employee_advances").delete().eq("id", parsed.data.id).eq("organization_id", c.orgId).is("deducted_in_run", null);
  return error ? fail(error, "delete advance") : done();
}
