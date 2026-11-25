"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { publicEnv } from "@/env";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { commissionPaymentError, marketerHref } from "@/lib/marketers";
import { hashPortalToken, newPortalToken } from "@/lib/portal-token";
import { createClient } from "@/lib/supabase/server";
import { optionalText } from "@/lib/validation/numbers";

/**
 * Success partners («شركاء النجاح» — code: marketers) and their reward («المكافأة» — code:
 * commission). marketers.manage edits partners and their page link; finance.manage pays a due
 * reward (public.record_commission_payment → PV- voucher). Every rule is re-checked in the database.
 */
const id = z.uuid();
const digits = (v: unknown) => (typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[\s-]/g, "") : v);

function fail(error: { code?: string; message?: string } | null, what: string): ActionResult<never> {
  if (error?.code === "42501") return { ok: false, error: "noAccess" };
  const mapped = commissionPaymentError(error?.message);
  if (mapped) return { ok: false, error: mapped === "invalid" ? "invalid" : mapped };
  if (/marketer inactive/.test(error?.message ?? "")) return { ok: false, error: "partnerInactive" };
  console.error(`[marketers] ${what} failed`, { code: error?.code });
  return { ok: false, error: "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/marketers");
  return { ok: true, data };
};

const marketerSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(160),
    phone: z.preprocess((v) => {
      const d = typeof v === "string" ? String(digits(v)) : v;
      if (typeof d !== "string" || d === "") return null;
      if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
      if (/^5\d{8}$/.test(d)) return `966${d}`;
      return d;
    }, z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable()),
    commission_percent: z.number().min(0).max(50),
    iban: z.preprocess((v) => {
      const d = typeof v === "string" ? String(digits(v)).toUpperCase() : v;
      return d === "" ? null : d;
    }, z.string().regex(/^SA\d{22}$/, "ibanInvalid").nullable()),
    notes: optionalText(1000),
    is_active: z.boolean(),
  })
  .strict();

export async function saveMarketer(input: unknown): Promise<ActionResult<{ number: string }>> {
  const session = await getSession();
  if (!can(session, "marketers.manage")) return { ok: false, error: "noAccess" };
  const parsed = marketerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: marketerId, ...data } = parsed.data;
  const supabase = await createClient();
  // a new percentage applies to quotes priced from now on; contracts keep their own (frozen in the database)
  const q = marketerId
    ? supabase.from("marketers").update(data).eq("id", marketerId).eq("organization_id", session.organization.id).select("number").single()
    : supabase.from("marketers").insert({ ...data, organization_id: session.organization.id }).select("number").single();
  const { data: row, error } = await q;
  if (error || !row) return fail(error, "save");
  revalidatePath("/clients", "layout");
  return done({ number: row.number });
}

/** A new page link for the partner, shown ONCE (only its hash is stored); older links stop working. */
export async function issueMarketerLink(input: unknown): Promise<ActionResult<{ url: string }>> {
  const session = await getSession();
  if (!can(session, "marketers.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: m } = await supabase.from("marketers").select("id, number").eq("id", parsed.data.id).eq("organization_id", session.organization.id).maybeSingle();
  if (!m) return { ok: false, error: "invalid" };
  const token = newPortalToken();
  const { error } = await supabase.rpc("issue_marketer_link", { p_marketer: m.id, p_token_hash: hashPortalToken(token) });
  if (error) return fail(error, "link");
  const h = await headers();
  const base = publicEnv().NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  return done({ url: marketerHref(base, m.number, token) });
}

export async function revokeMarketerLinks(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "marketers.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_marketer_links", { p_marketer: parsed.data.id });
  if (error) return fail(error, "revoke");
  return done();
}

/** Pays a due reward in full → payment voucher (PV-). */
export async function payCommission(input: unknown): Promise<ActionResult<{ number: string }>> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z
    .object({
      id,
      paid_on: z.iso.date(),
      method: z.enum(["transfer", "cash", "cheque"]),
      reference: optionalText(80),
      note: optionalText(500),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_commission_payment", { p_commission: v.id, p_paid_on: v.paid_on, p_method: v.method, p_reference: v.reference, p_note: v.note });
  if (error || !data) return fail(error, "pay");
  revalidatePath("/", "layout");
  return done({ number: data });
}
