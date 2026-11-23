"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { linkExpiry, percentSum, scheduleAmounts } from "@/lib/contracts";
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
    const { data: q } = await supabase.from("quotes").select("id, status, current_version, client_id, service").eq("id", v.quote_id!).eq("organization_id", orgId).maybeSingle();
    if (!q || q.status !== "issued") return { ok: false, error: "quoteNotIssued" };
    const { data: ver } = await supabase.from("quote_versions").select("total, selection").eq("quote_id", q.id).eq("version", q.current_version).maybeSingle();
    if (!ver) return { ok: false, error: "invalid" };
    const projectType = ((ver.selection as { options?: { projectType?: string } } | null)?.options?.projectType ?? "full") as "full" | "labour" | "supply";
    total = Number(ver.total);
    const { data: c, error } = await supabase
      .from("contracts")
      .insert({
        organization_id: orgId, quote_id: q.id, quote_version: q.current_version, client_id: q.client_id, service: q.service,
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

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const now = new Date().toISOString();
  const { error: e1 } = await supabase.from("client_portal_links").update({ revoked_at: now }).eq("contract_id", c.id).is("revoked_at", null);
  if (e1) return fail(e1, "revoke");
  const { error: e2 } = await supabase.from("client_portal_links").insert({
    organization_id: session.organization.id, contract_id: c.id, token_hash: tokenHash,
    expires_at: linkExpiry(c.start_date, c.duration_days, c.warranty_months).toISOString(),
  });
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
