"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { flushWhatsApp } from "@/lib/notifications/flush";
import { decideApproval } from "@/app/(app)/quotations/actions";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(error: { code?: string } | null, what: string): ActionResult<never> {
  console.error(`[finance] ${what} failed`, { code: error?.code });
  return { ok: false, error: error?.code === "42501" ? "noAccess" : "error" };
}
const done = (): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true };
};

/** Money received from a client: a contract payment (by the database function) or an addendum's own payment. */
export async function recordPayment(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z
    .object({
      payment_id: z.string().regex(/^(ad:)?[0-9a-f-]{36}$/),
      paid_on: day,
      amount: z.number().positive().max(100_000_000),
      method: z.enum(["transfer", "cash", "cheque", "card"]),
      reference: z.string().trim().max(80).nullable(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();
  if (v.payment_id.startsWith("ad:")) {
    const { error } = await supabase
      .from("addenda")
      .update({ payment_status: "paid", paid_at: v.paid_on, paid_amount: v.amount })
      .eq("id", v.payment_id.slice(3))
      .eq("organization_id", session.organization.id)
      .eq("status", "accepted");
    return error ? fail(error, "addendum payment") : done();
  }
  const { error } = await supabase.rpc("record_client_payment", { p_payment: v.payment_id, p_paid_on: v.paid_on, p_amount: v.amount, p_method: v.method, p_reference: v.reference });
  after(() => flushWhatsApp());
  return error ? fail(error, "record payment") : done();
}

export async function setExpectedDate(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ payment_id: id, date: day.nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_payments").update({ expected_date: parsed.data.date }).eq("id", parsed.data.payment_id).eq("organization_id", session.organization.id);
  return error ? fail(error, "expected date") : done();
}

/** Cash in the bank today and the monthly payday (the forecast starts from them). */
export async function saveCashSettings(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ cash_balance: z.number().min(-100_000_000).max(1_000_000_000), cash_balance_on: day, payday: z.number().int().min(1).max(28) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("finance_settings").upsert({ organization_id: session.organization.id, ...parsed.data });
  return error ? fail(error, "cash settings") : done();
}

/** One-tap decision from the owner's home: the database applies it to the quote, purchase or addendum. */
export async function decideFromDashboard(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "approvals.decide")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ approval_id: id, decision: z.enum(["approved", "rejected"]) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: a } = await supabase.from("approvals").select("entity").eq("id", parsed.data.approval_id).eq("organization_id", session.organization.id).maybeSingle();
  if (!a) return { ok: false, error: "invalid" };
  if (a.entity === "quote") {
    const r = await decideApproval({ id: parsed.data.approval_id, decision: parsed.data.decision, note: null });
    if (r.ok) revalidatePath("/", "layout");
    return r;
  }
  const { error } = await supabase.from("approvals").update({ status: parsed.data.decision }).eq("id", parsed.data.approval_id).eq("status", "pending");
  return error ? fail(error, "decide") : done();
}
