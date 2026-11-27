"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { publicEnv } from "@/env";
import { hashPortalToken, newPortalToken } from "@/lib/portal-token";
import { after } from "next/server";
import { z } from "zod";
import { runBackground } from "@/lib/background";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { readInvoice, type InvoiceMedia } from "@/lib/ai/invoice";
import { can, getSession } from "@/lib/auth/session";
import { invoiceFlags, itemsToLink, lineAmount, purchaseTotals, type InvoiceDraft, type InvoiceFlag } from "@/lib/purchases";
import { rateLimit } from "@/lib/rate-limit";
import { subWorkError } from "@/lib/subcontractors";
import { createClient } from "@/lib/supabase/server";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_BYTES = 4 * 1024 * 1024; // Vercel request bodies are capped near 4.5 MB; photos are shrunk in the browser first

async function authorize(permission: "purchases.manage" | "approvals.decide" = "purchases.manage") {
  const session = await getSession();
  if (!can(session, permission)) return { ok: false, error: "noAccess" } as const;
  return { supabase: await createClient(), orgId: session.organization.id, userId: session.userId };
}
type Ctx = Exclude<Awaited<ReturnType<typeof authorize>>, { ok: false }>;
const isCtx = (c: Awaited<ReturnType<typeof authorize>>): c is Ctx => !("ok" in c);

function fail(error: { code?: string; message?: string } | null, what: string): ActionResult<never> {
  console.error(`[purchases] ${what} failed`, { code: error?.code });
  const m = error?.message ?? "";
  if (error?.code === "42501") return { ok: false, error: "noAccess" };
  if (m.includes("not enough quantity")) return { ok: false, error: "notEnoughStock" };
  if (m.includes("stays on its project")) return { ok: false, error: "projectSpecific" };
  if (m.includes("add up")) return { ok: false, error: "totalsMismatch" };
  if (error?.code === "23505") return { ok: false, error: "itemExists" };
  return { ok: false, error: "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/purchases", "layout");
  return { ok: true, data };
};

/** What the file really is (magic bytes), not what the browser claims. */
function sniff(bytes: Uint8Array): InvoiceMedia | null {
  const at = (sig: number[], o = 0) => sig.every((b, i) => bytes[o + i] === b);
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (at([0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  return null;
}
const EXT: Record<InvoiceMedia, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/**
 * Upload the invoice photo/PDF (private bucket) and, when AI is set up, read
 * it into a draft. Nothing is saved as a purchase here — the user reviews first.
 */
export async function uploadInvoice(fd: FormData): Promise<ActionResult<{ path: string; draft: InvoiceDraft | null; flags: InvoiceFlag[]; aiError?: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const file = fd.get("file");
  const wantAi = fd.get("ai") === "1";
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "fileMissing" };
  if (file.size > MAX_BYTES) return { ok: false, error: "fileTooLarge" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) return { ok: false, error: "fileType" };

  const path = `${ctx.orgId}/${randomUUID()}.${EXT[type]}`;
  const { error: upErr } = await ctx.supabase.storage.from("purchase-docs").upload(path, bytes, { contentType: type, upsert: false });
  if (upErr) {
    console.error("[purchases] upload failed");
    return { ok: false, error: "error" };
  }
  if (!wantAi) return { ok: true, data: { path, draft: null, flags: [] } };

  const limit = await rateLimit(`ai:invoice:${ctx.userId}`, 30, 3600);
  if (limit !== "ok") return { ok: true, data: { path, draft: null, flags: [], aiError: limit === "limited" ? "rateLimited" : "aiFailed" } };
  const r = await readInvoice(bytes, type);
  if (!r.ok) return { ok: true, data: { path, draft: null, flags: [], aiError: r.error } };
  return { ok: true, data: { path, draft: r.draft, flags: invoiceFlags(r.draft) } };
}

const optText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable());

const lineSchema = z
  .object({
    kind: z.enum(["material", "expense"]),
    item_id: id.nullable(),
    new_item: z.object({ name: z.string().trim().min(2).max(160), unit: z.string().trim().min(1).max(20), is_general: z.boolean(), product_id: id.nullable().optional() }).strict().nullable(),
    description: z.string().trim().min(1, "required").max(200),
    colour: optText(60),
    quantity: z.number().positive().max(1_000_000),
    unit: z.string().trim().min(1).max(20),
    unit_price: z.number().min(0).max(10_000_000),
    /** the catalogue product of a suggested line (quote purchase list) — links an unlinked stock item */
    product_id: id.nullable().optional(),
  })
  .strict()
  .refine((l) => l.kind === "expense" || l.item_id || l.new_item, { message: "itemRequired", path: ["item_id"] });

const purchaseSchema = z
  .object({
    id: id.optional(),
    supplier_id: id.nullable(),
    supplier_name: optText(160),
    supplier_vat: z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") || null : v), z.string().regex(/^3\d{13}3$/, "vatInvalid").nullable()),
    invoice_number: optText(60),
    invoice_date: day.nullable(),
    contract_id: id.nullable(),
    vat: z.number().min(0).max(10_000_000),
    notes: optText(2000),
    attachment_path: z.string().max(300).nullable(),
    ai_extracted: z.boolean(),
    ai_flags: z.array(z.string().max(60)).max(40),
    lines: z.array(lineSchema).min(1).max(200),
    submit: z.boolean(),
  })
  .strict();

export async function savePurchase(input: unknown): Promise<ActionResult<{ number: string; status: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  // the attachment must be one of this organization's files
  if (d.attachment_path && !new RegExp(`^${ctx.orgId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(d.attachment_path)) return { ok: false, error: "invalid" };

  // new inventory items first (or reuse an existing one with the same name + unit)
  const lines = [];
  for (const l of d.lines) {
    let itemId = l.kind === "material" ? l.item_id : null;
    if (l.kind === "material" && !itemId && l.new_item) {
      const { data: existing } = await ctx.supabase.from("inventory_items").select("id, product_id").eq("organization_id", ctx.orgId).eq("name", l.new_item.name).eq("unit", l.new_item.unit).maybeSingle();
      if (existing) {
        itemId = existing.id;
        // link an existing unlinked item to the chosen catalogue product (calibration)
        if (l.new_item.product_id && !existing.product_id) {
          const { error } = await ctx.supabase.from("inventory_items").update({ product_id: l.new_item.product_id }).eq("id", existing.id).is("product_id", null);
          if (error) return fail(error, "link item");
        }
      }
      else {
        const { data: created, error } = await ctx.supabase.from("inventory_items").insert({ organization_id: ctx.orgId, ...l.new_item }).select("id").single();
        if (error || !created) return fail(error, "create item");
        itemId = created.id;
      }
    }
    lines.push({ kind: l.kind, item_id: itemId, description: l.description, colour: l.colour, quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, amount: lineAmount(l.quantity, l.unit_price) });
  }
  // suggested lines that matched an existing, unlinked stock item carry its catalogue product: link it
  const picked = [...new Set(d.lines.filter((l) => l.kind === "material" && l.item_id && l.product_id).map((l) => l.item_id as string))];
  if (picked.length) {
    const { data: current } = await ctx.supabase.from("inventory_items").select("id, product_id").eq("organization_id", ctx.orgId).in("id", picked);
    for (const link of itemsToLink(d.lines, current ?? [])) {
      const { error } = await ctx.supabase.from("inventory_items").update({ product_id: link.product_id }).eq("id", link.id).eq("organization_id", ctx.orgId).is("product_id", null);
      if (error) return fail(error, "link item");
    }
  }
  const totals = purchaseTotals(lines, d.vat);
  const row = {
    supplier_id: d.supplier_id, supplier_name: d.supplier_name, supplier_vat: d.supplier_vat, invoice_number: d.invoice_number, invoice_date: d.invoice_date,
    contract_id: d.contract_id, notes: d.notes, attachment_path: d.attachment_path, ai_extracted: d.ai_extracted, ai_flags: { flags: d.ai_flags },
    ...totals,
  };
  const { data: saved, error } = d.id
    ? await ctx.supabase.from("purchases").update({ ...row, status: "draft" }).eq("id", d.id).eq("organization_id", ctx.orgId).select("id, number").single()
    : await ctx.supabase.from("purchases").insert({ ...row, organization_id: ctx.orgId }).select("id, number").single();
  if (error || !saved) return fail(error, "save purchase");

  const { error: delErr } = await ctx.supabase.from("purchase_lines").delete().eq("purchase_id", saved.id);
  if (delErr) return fail(delErr, "replace lines");
  const { error: lineErr } = await ctx.supabase.from("purchase_lines").insert(lines.map((l, i) => ({ ...l, organization_id: ctx.orgId, purchase_id: saved.id, seq: i + 1 })));
  if (lineErr) return fail(lineErr, "save lines");

  if (!d.submit) return done({ number: saved.number, status: "draft" });
  const { data: status, error: subErr } = await ctx.supabase.rpc("submit_purchase", { p_id: saved.id });
  if (subErr) return fail(subErr, "submit");
  after(runBackground);
  return done({ number: saved.number, status: String(status) });
}

export async function cancelPurchase(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("purchases").update({ status: "cancelled" }).eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  if (error) return fail(error, "cancel");
  return done();
}

/** Owner approves or rejects a purchase above the limit; the database records it. */
export async function decidePurchase(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("approvals.decide");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ approval_id: id, decision: z.enum(["approved", "rejected"]), note: optText(1000).optional() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase
    .from("approvals")
    .update({ status: parsed.data.decision, decision_note: parsed.data.note ?? null })
    .eq("id", parsed.data.approval_id)
    .eq("organization_id", ctx.orgId)
    .eq("entity", "purchase")
    .eq("status", "pending");
  if (error) return fail(error, "decide");
  return done();
}

export async function moveStock(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({ item_id: id, quantity: z.number().positive().max(1_000_000), from: id.nullable(), to: id.nullable(), note: optText(300) })
    .strict()
    .refine((m) => m.from !== m.to, { message: "sameLocation", path: ["to"] })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const m = parsed.data;
  const { error } = await ctx.supabase.rpc("move_stock", { p_item: m.item_id, p_quantity: m.quantity, p_from: m.from, p_to: m.to, p_note: m.note });
  if (error) return fail(error, "move stock");
  return done();
}

export async function saveItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({ id: id.optional(), name: z.string().trim().min(2, "required").max(160), unit: z.string().trim().min(1).max(20), is_general: z.boolean(), product_id: id.nullable().optional() })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: itemId, ...row } = parsed.data;
  const { data, error } = itemId
    ? await ctx.supabase.from("inventory_items").update(row).eq("id", itemId).eq("organization_id", ctx.orgId).select("id").single()
    : await ctx.supabase.from("inventory_items").insert({ ...row, organization_id: ctx.orgId }).select("id").single();
  if (error || !data) return fail(error, "save item");
  return done({ id: data.id });
}

// --- Subcontractors (§3.11) -------------------------------------------------------

const phone = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const d = v.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");
  if (d === "") return null;
  return /^05\d{8}$/.test(d) ? `966${d.slice(1)}` : d;
}, z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable());

export async function saveSubcontractor(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({
      id: id.optional(),
      name: z.string().trim().min(2, "required").max(160),
      phone,
      services: z.array(z.enum(["gypsum", "interior", "exterior"])).max(3),
      vat_number: z.preprocess((v) => (typeof v === "string" ? v.replace(/\D/g, "") || null : v), z.string().regex(/^3\d{13}3$/, "vatInvalid").nullable()),
      iban: z.preprocess((v) => (typeof v === "string" ? v.replace(/\s/g, "").toUpperCase() || null : v), z.string().regex(/^SA\d{22}$/, "ibanInvalid").nullable()),
      notes: optText(1000),
      is_active: z.boolean(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: subId, ...row } = parsed.data;
  const { data, error } = subId
    ? await ctx.supabase.from("subcontractors").update(row).eq("id", subId).eq("organization_id", ctx.orgId).select("id").single()
    : await ctx.supabase.from("subcontractors").insert({ ...row, organization_id: ctx.orgId }).select("id").single();
  if (error || !data) return fail(error, "save subcontractor");
  return done({ id: data.id });
}

export async function saveAgreement(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({
      id: id.optional(),
      subcontractor_id: id,
      contract_id: id,
      scope: z.string().trim().min(2, "required").max(1000),
      basis: z.enum(["lump", "per_m2"]),
      rate: z.number().min(0).max(100_000_000),
      quantity_m2: z.number().min(0).max(1_000_000).nullable(),
      schedule: z.enum(["weekly", "progress"]),
      status: z.enum(["active", "closed"]),
      auto_progress: z.boolean().optional(),
    })
    .strict()
    .refine((g) => g.basis === "lump" || g.quantity_m2 != null, { message: "required", path: ["quantity_m2"] })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: agreementId, ...row } = parsed.data;
  const clean = { ...row, quantity_m2: row.basis === "lump" ? null : row.quantity_m2 };
  if (clean.auto_progress === undefined) delete clean.auto_progress;
  const { error } = agreementId
    ? await ctx.supabase.from("subcontractor_agreements").update(clean).eq("id", agreementId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("subcontractor_agreements").insert({ ...clean, organization_id: ctx.orgId });
  if (error) return fail(error, "save agreement");
  return done();
}

/** Work done by a subcontractor; the database prices it from the agreement. */
export async function addSubWork(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z
    .object({ agreement_id: id, work_date: day, quantity_m2: z.number().positive().max(1_000_000).nullable(), percent: z.number().positive().max(100).nullable(), note: optText(500) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { error } = await ctx.supabase.from("subcontractor_work").insert({ ...parsed.data, organization_id: ctx.orgId, amount: 0 });
  if (error) {
    const why = error.code === "22023" ? subWorkError(error.message) : null;
    if (why) return { ok: false, error: why };
    return fail(error, "sub work");
  }
  return done();
}

export async function deleteSubWork(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("subcontractor_work").delete().eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  if (error) return fail(error, "delete sub work");
  return done();
}

/** Paying a subcontractor is a finance action. */
export async function addSubPayment(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z
    .object({ agreement_id: id, paid_on: day, amount: z.number().positive().max(100_000_000), method: z.enum(["transfer", "cash", "cheque"]), reference: optText(80), note: optText(500) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("subcontractor_payments").insert({ ...parsed.data, organization_id: session.organization.id });
  if (error) return fail(error, "sub payment");
  return done();
}

// --- Petty cash (§3.11) -----------------------------------------------------------

export async function createPettyAccount(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ holder_id: id, name: z.string().trim().min(2, "required").max(120) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("petty_cash_accounts").insert({ ...parsed.data, organization_id: session.organization.id });
  if (error) return fail(error, "petty account");
  return done();
}

/** Top-up / return (finance) or an expense (the holder), optionally with the receipt photo. */
export async function addPettyEntry(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const parsed = z
    .object({
      account_id: id,
      kind: z.enum(["topup", "expense", "return"]),
      entry_date: day,
      amount: z.number().positive().max(10_000_000),
      contract_id: id.nullable(),
      description: z.string().trim().min(1, "required").max(300),
      supplier_name: optText(160),
      attachment_path: z.string().max(300).nullable(),
      ai_extracted: z.boolean(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.kind !== "expense" && !can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const orgId = session.organization.id;
  if (v.attachment_path && !new RegExp(`^${orgId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(v.attachment_path)) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("petty_cash_entries").insert({ ...v, contract_id: v.kind === "expense" ? v.contract_id : null, organization_id: orgId });
  if (error) return fail(error, "petty entry");
  return done();
}

const paySchema = z
  .object({ id: z.uuid(), date: day, from: z.enum(["bank", "cash"]), reference: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(80).nullable()) })
  .strict();

/** The supplier was paid for this recorded purchase (finance only); Qoyod receives the bill payment. */
export async function recordPurchasePayment(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "finance.manage")) return { ok: false, error: "noAccess" };
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_purchase_payment", { p_purchase: parsed.data.id, p_date: parsed.data.date, p_from: parsed.data.from, p_reference: parsed.data.reference });
  if (error) {
    if (error.code === "42501") return { ok: false, error: "noAccess" };
    if (error.code === "22023") return { ok: false, error: /already/.test(error.message) ? "alreadyPaid" : "invalid" };
    console.error("[purchases] payment failed", { code: error.code });
    return { ok: false, error: "error" };
  }
  after(runBackground);
  revalidatePath("/purchases", "layout");
  return { ok: true };
}

/** A subcontractor's own page (purchases.manage): a new link (the token is shown once), the older one revoked. */
export async function issueSubLink(input: unknown): Promise<ActionResult<{ url: string }>> {
  const session = await getSession();
  if (!can(session, "purchases.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { data: s } = await supabase.from("subcontractors").select("id, number").eq("id", parsed.data.id).eq("organization_id", session.organization.id).maybeSingle();
  if (!s) return { ok: false, error: "invalid" };
  const token = newPortalToken();
  const { error } = await supabase.rpc("issue_subcontractor_link", { p_sub: s.id, p_token_hash: hashPortalToken(token) });
  if (error) {
    console.error("[purchases] sub link failed", { code: error.code });
    return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
  }
  const h = await headers();
  const base = publicEnv().NEXT_PUBLIC_SITE_URL ?? `https://${h.get("host")}`;
  revalidatePath("/purchases", "layout");
  return { ok: true, data: { url: `${base}/s/${s.number}/${token}` } };
}

export async function revokeSubLinks(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "purchases.manage")) return { ok: false, error: "noAccess" };
  const parsed = z.object({ id: z.uuid() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_subcontractor_links", { p_sub: parsed.data.id });
  if (error) {
    console.error("[purchases] sub revoke failed", { code: error.code });
    return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
  }
  revalidatePath("/purchases", "layout");
  return { ok: true };
}
