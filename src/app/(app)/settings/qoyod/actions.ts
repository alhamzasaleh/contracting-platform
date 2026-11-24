"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { runBackground } from "@/lib/background";
import { qoyodOptions, type QoyodOptions } from "@/lib/qoyod/client";
import { cashAccountOrNull } from "@/lib/qoyod/payloads";
import { qoyodAutoSetup } from "@/lib/qoyod/setup";
import { runQoyodSync } from "@/lib/qoyod/sync";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PATH = "/settings/qoyod";

/** Check the key against Qoyod first, then store it (server-side only; the page sees the last 4 characters). */
export async function saveQoyodKey(input: unknown): Promise<ActionResult<QoyodOptions>> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ key: z.string().trim().regex(/^[A-Za-z0-9_-]{8,200}$/) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if ((await rateLimit(`qoyod:key:${session.userId}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  let options: QoyodOptions;
  try {
    options = await qoyodOptions(parsed.data.key);
  } catch {
    return { ok: false, error: "qoyodKey" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("qoyod_set_key", { p_org: session.organization.id, p_key: parsed.data.key });
  if (error) {
    console.error("[qoyod] save key failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  await applyAutoSetup(session, parsed.data.key);
  revalidatePath(PATH);
  return { ok: true, data: await qoyodOptions(parsed.data.key).catch(() => options) };
}

/**
 * Prepare Qoyod from our side: warehouse, accounts and our service products are
 * picked / created automatically. Only empty settings are filled (the owner's
 * choices stay); sending is switched on in Draft mode once the basics exist.
 */
async function applyAutoSetup(session: Awaited<ReturnType<typeof getSession>>, key: string): Promise<boolean> {
  try {
    const auto = await qoyodAutoSetup(key, !!session.organization.vat_number);
    const supabase = await createClient();
    const { data: cur } = await supabase.from("qoyod_settings").select("enabled, inventory_id, receive_account_id, expense_account_id, salary_account_id, cash_account_id, subcontract_account_id, service_products, addendum_product_id").eq("organization_id", session.organization.id).maybeSingle();
    const products = { ...auto.service_products, ...((cur?.service_products ?? {}) as Record<string, number>) };
    const inventory_id = cur?.inventory_id ?? auto.inventory_id;
    const receive_account_id = cur?.receive_account_id ?? auto.receive_account_id;
    const { error } = await supabase
      .from("qoyod_settings")
      .update({
        inventory_id, receive_account_id, expense_account_id: cur?.expense_account_id ?? auto.expense_account_id,
        salary_account_id: cur?.salary_account_id ?? auto.salary_account_id, cash_account_id: cashAccountOrNull(cur?.cash_account_id ?? auto.cash_account_id, receive_account_id),
        subcontract_account_id: cur?.subcontract_account_id ?? auto.subcontract_account_id,
        service_products: products, addendum_product_id: cur?.addendum_product_id ?? auto.addendum_product_id,
        enabled: cur?.enabled || !!(inventory_id && receive_account_id), updated_by: session.userId,
      })
      .eq("organization_id", session.organization.id);
    return !error;
  } catch {
    console.error("[qoyod] auto setup failed");
    return false;
  }
}

/** Run the automatic preparation again (e.g. after adding a bank account in Qoyod). */
export async function qoyodAutoSetupNow(): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  if ((await rateLimit(`qoyod:setup:${session.userId}`, 10, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const { data: key } = await createAdminClient().rpc("qoyod_api_key", { p_org: session.organization.id });
  if (!key) return { ok: false, error: "qoyodNoKey" };
  const ok = await applyAutoSetup(session, key as string);
  revalidatePath(PATH);
  return ok ? { ok: true } : { ok: false, error: "qoyodSetup" };
}

export async function removeQoyodKey(): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("qoyod_set_key", { p_org: session.organization.id, p_key: "" });
  if (error) return { ok: false, error: "error" };
  revalidatePath(PATH);
  return { ok: true };
}

/** Accounts, warehouses and products from Qoyod, for the dropdowns. */
export async function loadQoyodOptions(): Promise<ActionResult<QoyodOptions>> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  if ((await rateLimit(`qoyod:options:${session.userId}`, 30, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const { data: key } = await createAdminClient().rpc("qoyod_api_key", { p_org: session.organization.id });
  if (!key) return { ok: false, error: "qoyodNoKey" };
  try {
    return { ok: true, data: await qoyodOptions(key as string) };
  } catch {
    return { ok: false, error: "qoyodKey" };
  }
}

const id = z.number().int().positive().nullable();
const settingsSchema = z
  .object({
    enabled: z.boolean(),
    invoice_status: z.enum(["Draft", "Approved"]),
    inventory_id: id,
    receive_account_id: id,
    expense_account_id: id,
    salary_account_id: id.optional(),
    cash_account_id: id.optional(),
    subcontract_account_id: id.optional(),
    service_products: z.object({ gypsum: id, interior: id, exterior: id }).strict(),
    addendum_product_id: id,
  })
  .strict();

export async function saveQoyodSettings(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  const supabase = await createClient();
  if (v.enabled) {
    const { data: s } = await supabase.from("qoyod_settings").select("key_last4").eq("organization_id", session.organization.id).maybeSingle();
    if (!s?.key_last4) return { ok: false, error: "qoyodNoKey" };
    if (!v.inventory_id || !v.receive_account_id) return { ok: false, error: "qoyodIncomplete" };
  }
  const products = Object.fromEntries(Object.entries(v.service_products).filter(([, x]) => x != null)) as Record<string, number>;
  const row = { ...v, service_products: products, updated_by: session.userId };
  const { data: existing } = await supabase.from("qoyod_settings").select("organization_id, cash_account_id").eq("organization_id", session.organization.id).maybeSingle();
  // the cash account is never the bank account (petty cash would be counted in both; the DB refuses it too)
  const cash = v.cash_account_id === undefined ? (existing?.cash_account_id ?? null) : v.cash_account_id;
  if (cash != null && cash === v.receive_account_id) return { ok: false, error: "qoyodCashIsBank" };
  const { error } = existing
    ? await supabase.from("qoyod_settings").update(row).eq("organization_id", session.organization.id)
    : await supabase.from("qoyod_settings").insert({ ...v, service_products: products, organization_id: session.organization.id });
  if (error) {
    if (error.code === "23514" && error.message.includes("qoyod_settings_cash_not_bank")) return { ok: false, error: "qoyodCashIsBank" };
    console.error("[qoyod] settings failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  // sending switched to "Approved": what waited for it goes now (not in up to 12 hours)
  if (v.enabled && v.invoice_status === "Approved") {
    const { error: e } = await supabase.rpc("qoyod_wake_waiting", { p_org: session.organization.id });
    if (e) console.error("[qoyod] wake failed", { code: e.code });
    else after(runBackground);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * The owner approved the draft invoices in Qoyod: send the payments (and anything else
 * waiting for an approval) now instead of at the next retry.
 */
export async function qoyodApprovedSendNow(input: unknown): Promise<ActionResult<{ count: number }>> {
  const session = await getSession();
  if (!can(session, "settings.manage") && !can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({}).strict().safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "invalid" };
  if ((await rateLimit(`qoyod:wake:${session.organization.id}`, 20, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qoyod_wake_waiting", { p_org: session.organization.id });
  if (error) return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
  after(runBackground);
  revalidatePath(PATH);
  return { ok: true, data: { count: Number(data ?? 0) } };
}

export async function qoyodSyncNow(): Promise<ActionResult<{ done: number; failed: number }>> {
  const session = await getSession();
  if (!can(session, "settings.manage") && !can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  if ((await rateLimit(`qoyod:sync:${session.organization.id}`, 20, 600)) !== "ok") return { ok: false, error: "rateLimited" };
  const r = await runQoyodSync(20);
  revalidatePath(PATH);
  return { ok: true, data: r };
}

export async function qoyodRetry(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z.object({ id: z.uuid().nullable() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("qoyod_retry", { p_org: session.organization.id, p_job: parsed.data.id });
  if (error) return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
  after(runBackground);
  revalidatePath(PATH);
  return { ok: true };
}

export async function qoyodBackfill(input: unknown): Promise<ActionResult<{ count: number }>> {
  const session = await getSession();
  const parsed = z.object({ from: z.iso.date() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qoyod_backfill", { p_org: session.organization.id, p_from: parsed.data.from });
  if (error) return { ok: false, error: error.code === "42501" ? "noAccess" : "invalid" };
  after(runBackground);
  revalidatePath(PATH);
  return { ok: true, data: { count: Number(data ?? 0) } };
}
