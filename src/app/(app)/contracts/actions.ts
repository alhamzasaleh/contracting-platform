"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { runBackground } from "@/lib/background";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { linkExpiry, percentSum, portalLinkState, scheduleAmounts } from "@/lib/contracts";
import { loadWarrantyEnd } from "@/lib/data/contracts";
import { effectiveVatPercent } from "@/lib/costing";
import { paymentRequestError } from "@/lib/finance";
import { termsSchema } from "@/lib/contracts/terms";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/env";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function fail(error: { code?: string } | null, what: string): ActionResult<never> {
  console.error(`[contracts] ${what} failed`, { code: error?.code });
  return { ok: false, error: error?.code === "42501" ? "noAccess" : error?.code === "23505" ? "contractExists" : "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/contracts", "layout");
  revalidatePath("/quotations", "layout");
  return { ok: true, data };
};

const paymentsSchema = z
  .array(
    z
      .object({
        label: z.string().trim().min(1).max(120),
        percent: z.number().gt(0).max(100),
        due_event: z.enum(["signing", "material_supply", "board_closing", "primer_done", "handover", "custom"]),
      })
      .strict(),
  )
  .min(1)
  .max(12)
  .refine((p) => Math.abs(percentSum(p.map((x) => x.percent)) - 100) < 0.01, "sum100");

const contractSchema = z
  .object({
    quote_id: id.optional(),
    contract_id: id.optional(),
    start_date: day,
    duration_days: z.number().int().min(1).max(3650),
    warranty_months: z.number().int().min(0).max(120),
    notes: z.string().trim().max(4000).nullable(),
    payments: paymentsSchema,
  })
  .strict()
  .refine((v) => !!v.quote_id !== !!v.contract_id);

/** Creates (from an issued quote) or edits a draft/sent contract and its payment schedule. */
export async function saveContract(input: unknown): Promise<ActionResult<{ number: string }>> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = contractSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some((i) => i.message === "sum100") ? "paymentsSum" : "invalid" };
  const v = parsed.data;
  const orgId = session.organization.id;
  const supabase = await createClient();

  let contractId = v.contract_id ?? null;
  let number: string;
  let total: number;
  if (contractId) {
    const { data: c } = await supabase.from("contracts").select("id, number, status, total").eq("id", contractId).eq("organization_id", orgId).maybeSingle();
    if (!c || (c.status !== "draft" && c.status !== "sent")) return { ok: false, error: "contractLocked" };
    const { error } = await supabase
      .from("contracts")
      .update({ start_date: v.start_date, duration_days: v.duration_days, warranty_months: v.warranty_months, notes: v.notes })
      .eq("id", c.id);
    if (error) return fail(error, "update");
    number = c.number;
    total = Number(c.total);
    const { error: e2 } = await supabase.from("contract_payments").delete().eq("contract_id", c.id);
    if (e2) return fail(e2, "payments reset");
  } else {
    // From the quote's current, issued version (total and project type are frozen there).
    const { data: q } = await supabase.from("quotes").select("id, status, current_version, client_id, service, options").eq("id", v.quote_id!).eq("organization_id", orgId).maybeSingle();
    if (!q || q.status !== "issued") return { ok: false, error: "quoteNotIssued" };
    // with options the client picks later; until then the contract shows the first one offered
    const startVersion = q.options?.length ? (q.options.some((o) => o.version === q.current_version) ? q.current_version : q.options[0].version) : q.current_version;
    const { data: ver } = await supabase.from("quote_versions").select("total, selection").eq("quote_id", q.id).eq("version", startVersion).maybeSingle();
    if (!ver) return { ok: false, error: "invalid" };
    const projectType = ((ver.selection as { options?: { projectType?: string } } | null)?.options?.projectType ?? "full") as "full" | "labour" | "supply";
    total = Number(ver.total);
    // the company's clause settings are copied into the contract (editable until the client accepts)
    const { data: tpl } = await supabase.from("contract_templates").select("terms").eq("organization_id", orgId).maybeSingle();
    const { data: c, error } = await supabase
      .from("contracts")
      .insert({
        terms: (tpl?.terms ?? {}) as Json,
        organization_id: orgId, quote_id: q.id, quote_version: startVersion, options: q.options ?? null, client_id: q.client_id, service: q.service,
        project_type: projectType, start_date: v.start_date, duration_days: v.duration_days, warranty_months: v.warranty_months,
        total, notes: v.notes,
      })
      .select("id, number")
      .single();
    if (error) return fail(error, "create");
    contractId = c.id;
    number = c.number;
  }

  const amounts = scheduleAmounts(total, v.payments.map((p) => p.percent));
  const { error: e3 } = await supabase.from("contract_payments").insert(
    v.payments.map((p, i) => ({ organization_id: orgId, contract_id: contractId!, seq: i + 1, label: p.label, percent: p.percent, amount: amounts[i], due_event: p.due_event })),
  );
  if (e3) return fail(e3, "payments");
  return done({ number });
}

/**
 * Creates the client page link: a long random token shown ONCE (only its hash
 * is stored); older links are revoked. Marks the contract as sent.
 */
export async function sendContract(input: unknown): Promise<ActionResult<{ url: string }>> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts").select("id, number, status, start_date, duration_days, warranty_months").eq("id", parsed.data.id).eq("organization_id", session.organization.id).maybeSingle();
  if (!c || c.status === "cancelled") return { ok: false, error: "invalid" };
  // the client page closes when the warranty ends: no new link after that (the database enforces it too)
  if (c.status === "accepted") {
    const end = await loadWarrantyEnd(session, c.id);
    if (portalLinkState(c.status, end, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })).warrantyEnded) return { ok: false, error: "warrantyEnded" };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  // one locked step in the database: the new link is inserted, then the older ones revoked — two
  // presses at once can't leave two active links; if it is refused (warranty ended) nothing changes
  const { error: e2 } = await supabase.rpc("issue_portal_link", {
    p_contract: c.id, p_token_hash: tokenHash, p_expires: linkExpiry(c.start_date, c.duration_days, c.warranty_months).toISOString(),
  });
  // the database closes the client page once the warranty has ended, whatever the caller may see
  if (e2?.message?.includes("warranty_ended")) return { ok: false, error: "warrantyEnded" };
  if (e2) return fail(e2, "link");
  if (c.status === "draft") {
    const { error } = await supabase.from("contracts").update({ status: "sent" }).eq("id", c.id);
    if (error) return fail(error, "send");
  }
  const h = await headers();
  const base = publicEnv().NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  return done({ url: `${base}/p/${c.number}/${token}` });
}

export async function revokeLinks(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("client_portal_links").update({ revoked_at: new Date().toISOString() }).eq("contract_id", parsed.data.id).is("revoked_at", null);
  return error ? fail(error, "revoke") : done();
}

export async function cancelContract(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts").select("status").eq("id", parsed.data.id).maybeSingle();
  if (!c || c.status === "accepted") return { ok: false, error: "contractLocked" };
  const { error } = await supabase.from("contracts").update({ status: "cancelled" }).eq("id", parsed.data.id);
  if (!error) await supabase.from("client_portal_links").update({ revoked_at: new Date().toISOString() }).eq("contract_id", parsed.data.id).is("revoked_at", null);
  return error ? fail(error, "cancel") : done();
}

// --- Additional works (addenda, §3.8) ---------------------------------------------

const addendumSchema = z
  .object({
    id: id.optional(),
    contract_id: id,
    title: z.string().trim().min(2, "required").max(160),
    description: z.string().trim().min(2, "required").max(4000),
    amount: z.number().min(0).max(100_000_000),
    extra_days: z.number().int().min(0).max(365),
    submit: z.boolean(),
  })
  .strict();

/** Create or edit a draft addendum; VAT follows the company's VAT registration. With submit: to the owner. */
export async function saveAddendum(input: unknown): Promise<ActionResult<{ status: string }>> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = addendumSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: settings } = await supabase.from("pricing_settings").select("vat_percent").eq("organization_id", orgId).maybeSingle();
  const vatPercent = effectiveVatPercent(session.organization.vat_number, Number(settings?.vat_percent ?? 15));
  const { id: addendumId, submit, ...v } = parsed.data;
  const amount = Math.round(v.amount * 100) / 100;
  const vat = Math.round(amount * vatPercent) / 100;
  const row = { ...v, amount, vat_percent: vatPercent, vat, total: Math.round((amount + vat) * 100) / 100 };
  const { data: saved, error } = addendumId
    ? await supabase.from("addenda").update({ ...row, status: "draft" }).eq("id", addendumId).eq("organization_id", orgId).select("id").single()
    : await supabase.from("addenda").insert({ ...row, organization_id: orgId }).select("id").single();
  if (error || !saved) return fail(error, "save addendum");
  if (!submit) return done({ status: "draft" });
  const { data: status, error: e2 } = await supabase.rpc("submit_addendum", { p_id: saved.id });
  if (e2) return fail(e2, "submit addendum");
  after(runBackground);
  return done({ status: String(status) });
}

/** An addendum's estimated cost (costs.view): the project's estimate and profit include it. */
export async function saveAddendumCost(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage") || !can(session, "costs.view")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ addendum_id: id, material_cost: z.number().min(0).max(100_000_000), other_cost: z.number().min(0).max(100_000_000) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const v = parsed.data;
  // contract_id is set by the database from the addendum
  const { error } = await supabase
    .from("addendum_costs")
    .upsert({ addendum_id: v.addendum_id, organization_id: session.organization.id, material_cost: r2(v.material_cost), other_cost: r2(v.other_cost) }, { onConflict: "addendum_id" });
  return error ? fail(error, "addendum cost") : done();
}

/** Approved → visible on the client page for acceptance. */
export async function sendAddendum(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("addenda").update({ status: "sent" }).eq("id", parsed.data.id).eq("organization_id", session.organization.id).eq("status", "approved");
  return error ? fail(error, "send addendum") : done();
}

export async function cancelAddendum(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("addenda").update({ status: "cancelled" }).eq("id", parsed.data.id).eq("organization_id", session.organization.id).neq("status", "accepted");
  return error ? fail(error, "cancel addendum") : done();
}

/** Owner's decision on an addendum raised by someone else. */
export async function decideAddendum(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "approvals.decide")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ approval_id: id, decision: z.enum(["approved", "rejected"]) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("approvals")
    .update({ status: parsed.data.decision })
    .eq("id", parsed.data.approval_id)
    .eq("organization_id", session.organization.id)
    .eq("entity", "addendum")
    .eq("status", "pending");
  return error ? fail(error, "decide addendum") : done();
}

const paymentSchema = z
  .object({
    addendum_id: id,
    paid_on: day,
    amount: z.number().positive().max(100_000_000),
    method: z.enum(["transfer", "cash", "cheque", "card"]),
    reference: z.string().trim().max(80).nullable(),
  })
  .strict();

/**
 * Finance records money received for an addendum's own payment (full or partial).
 * The database keeps it cumulative, never above the total, and issues the receipt voucher.
 */
export async function recordAddendumPayment(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_addendum_payment", { p_addendum: v.addendum_id, p_paid_on: v.paid_on, p_amount: v.amount, p_method: v.method, p_reference: v.reference });
  if (error) return fail(error, "addendum payment");
  after(runBackground);
  revalidatePath("/", "layout");
  return done();
}

/** Staff request a material-supply or custom payment (stage payments follow the client's confirmation). */
export async function requestPayment(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage") && !can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ payment_id: id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_contract_payment", { p_payment: parsed.data.payment_id });
  if (error) {
    const why = error.code === "22023" ? paymentRequestError(error.message) : null;
    if (why) return { ok: false, error: why };
    return fail(error, "request payment");
  }
  after(runBackground);
  revalidatePath("/", "layout");
  return done();
}

/** Edit a contract's clauses (before the client accepts; the database refuses afterwards). */
export async function saveContractTerms(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "quotes.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ contract_id: z.uuid(), terms: termsSchema }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts").select("id, number, status").eq("id", parsed.data.contract_id).eq("organization_id", session.organization.id).maybeSingle();
  if (!c || (c.status !== "draft" && c.status !== "sent")) return { ok: false, error: "contractLocked" };
  const { error } = await supabase.from("contracts").update({ terms: parsed.data.terms as Json }).eq("id", c.id);
  if (error) return fail(error, "terms");
  revalidatePath(`/contracts/${c.number}`);
  return done();
}

/** The company's default clauses for new contracts (settings managers). */
export async function saveContractTemplate(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ terms: termsSchema }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("contract_templates")
    .upsert({ organization_id: session.organization.id, terms: parsed.data.terms as Json, updated_by: session.userId }, { onConflict: "organization_id" });
  if (error) return fail(error, "template");
  revalidatePath("/settings/contract");
  return done();
}
