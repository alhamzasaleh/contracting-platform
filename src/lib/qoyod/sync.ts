import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QoyodJobRow, QoyodSettingsRow } from "@/lib/supabase/database.types";
import { qoyod, QoyodError } from "./client";
import { qoyodAutoSetup } from "./setup";
import { customerBody, invoiceBody, invoicePaymentBody, invoiceRef, paymentRef, simpleBillBody, vendorBody } from "./payloads";

type Admin = ReturnType<typeof createAdminClient>;
type Ctx = { admin: Admin; key: string; s: QoyodSettingsRow };

/** Jobs that can't run yet (missing setting, waiting for the invoice) carry a code the settings page explains. */
class Blocked extends Error {}

const MAX_ATTEMPTS = 6;
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }) : today());

/**
 * Send queued records to Qoyod. Called right after events (`after()`), by the
 * daily job and by "sync now". Safe to run twice: references are unique in
 * Qoyod, and a record that already exists is found by its reference.
 */
export async function runQoyodSync(limit = 20): Promise<{ done: number; failed: number }> {
  const result = { done: 0, failed: 0 };
  let admin: Admin;
  try {
    admin = createAdminClient();
  } catch {
    return result;
  }
  const { data: jobs, error } = await admin.rpc("qoyod_claim_jobs", { p_limit: limit });
  if (error || !jobs?.length) return result;
  const ctxs = new Map<string, Ctx | null>();
  for (const job of jobs as QoyodJobRow[]) {
    if (!ctxs.has(job.organization_id)) {
      const [{ data: s }, { data: key }] = await Promise.all([
        admin.from("qoyod_settings").select("*").eq("organization_id", job.organization_id).maybeSingle(),
        admin.rpc("qoyod_api_key", { p_org: job.organization_id }),
      ]);
      let settings = s as QoyodSettingsRow | null;
      if (settings && key) settings = await fillMissing(admin, key as string, settings);
      ctxs.set(job.organization_id, settings && key ? { admin, key: key as string, s: settings } : null);
    }
    const ctx = ctxs.get(job.organization_id);
    try {
      if (!ctx) throw new Blocked("missing:key");
      const id = await runJob(ctx, job);
      await admin.from("qoyod_sync_jobs").update({ status: "done", qoyod_id: id, done_at: new Date().toISOString(), last_error: null }).eq("id", job.id);
      result.done++;
    } catch (e) {
      const msg = e instanceof Blocked || e instanceof QoyodError ? e.message : "error";
      const permanent = job.attempts >= MAX_ATTEMPTS || (e instanceof QoyodError && e.status === 401);
      const wait = Math.min(2 ** job.attempts, 60) * 60_000;
      await admin
        .from("qoyod_sync_jobs")
        .update({ status: permanent ? "failed" : "queued", last_error: msg.slice(0, 500), next_attempt_at: new Date(Date.now() + wait).toISOString() })
        .eq("id", job.id);
      if (permanent) result.failed++;
      console.error("[qoyod] job failed", { kind: job.kind, attempts: job.attempts, error: msg.slice(0, 80) });
    }
  }
  return result;
}

/** Something we create ourselves is missing (e.g. a service product) → prepare it in Qoyod now, once. */
async function fillMissing(admin: Admin, key: string, s: QoyodSettingsRow): Promise<QoyodSettingsRow> {
  const products = s.service_products ?? {};
  if (s.inventory_id && s.receive_account_id && s.expense_account_id && products.gypsum && products.interior && products.exterior && s.addendum_product_id) return s;
  try {
    const { data: org } = await admin.from("organizations").select("vat_number").eq("id", s.organization_id).single();
    const auto = await qoyodAutoSetup(key, !!org?.vat_number);
    const next = {
      inventory_id: s.inventory_id ?? auto.inventory_id, receive_account_id: s.receive_account_id ?? auto.receive_account_id, expense_account_id: s.expense_account_id ?? auto.expense_account_id,
      service_products: { ...auto.service_products, ...products }, addendum_product_id: s.addendum_product_id ?? auto.addendum_product_id,
    };
    await admin.from("qoyod_settings").update(next).eq("organization_id", s.organization_id);
    return { ...s, ...next };
  } catch {
    return s;
  }
}

function need<T>(v: T | null | undefined, code: string): T {
  if (v == null || v === ("" as unknown)) throw new Blocked(`missing:${code}`);
  return v;
}

async function doneId(ctx: Ctx, kind: QoyodJobRow["kind"], ref: string): Promise<number | null> {
  const { data } = await ctx.admin.from("qoyod_sync_jobs").select("qoyod_id").eq("organization_id", ctx.s.organization_id).eq("kind", kind).eq("ref", ref).eq("status", "done").maybeSingle();
  return data?.qoyod_id ?? null;
}

async function remember(ctx: Ctx, kind: "customer" | "vendor", entityType: "client" | "supplier", entityId: string, ref: string, id: number) {
  await ctx.admin.from("qoyod_sync_jobs").upsert(
    { organization_id: ctx.s.organization_id, kind, entity_type: entityType, entity_id: entityId, ref, status: "done", qoyod_id: id, done_at: new Date().toISOString() },
    { onConflict: "organization_id,kind,ref" },
  );
}

/** Create in Qoyod; if the reference already exists there (an earlier try that timed out), find it instead. */
async function createOrFind(ctx: Ctx, path: string, listKey: string, reference: string, body: unknown, pick: (r: Record<string, unknown>) => unknown): Promise<number> {
  try {
    const r = await qoyod<Record<string, unknown>>(ctx.key, "POST", path, body);
    const id = Number(pick(r));
    if (!id) throw new QoyodError(500, "no id returned");
    return id;
  } catch (e) {
    if (!(e instanceof QoyodError) || e.status < 400 || e.status >= 500 || e.status === 401) throw e;
    const found = await qoyod<Record<string, { id: number; reference?: string }[]>>(ctx.key, "GET", `${path}?q[reference_eq]=${encodeURIComponent(reference)}`).catch(() => null);
    const hit = found?.[listKey]?.find((x) => x.reference === reference);
    if (hit) return hit.id;
    throw e;
  }
}

async function customerId(ctx: Ctx, clientId: string): Promise<number> {
  const ref = `cl:${clientId}`;
  const known = await doneId(ctx, "customer", ref);
  if (known) return known;
  const { data: c } = await ctx.admin.from("clients").select("name, phone, city, number").eq("id", clientId).single();
  const r = await qoyod<{ contact?: { id: number } }>(ctx.key, "POST", "/customers", customerBody(need(c, "client")));
  const id = need(r.contact?.id, "customer");
  await remember(ctx, "customer", "client", clientId, ref, id);
  return id;
}

async function vendorId(ctx: Ctx, p: { supplier_id: string | null; supplier_name: string | null; supplier_vat: string | null; id: string }): Promise<number> {
  let v: { name: string; phone: string | null; vat_number: string | null };
  let ref: string;
  if (p.supplier_id) {
    ref = `sup:${p.supplier_id}`;
    const { data } = await ctx.admin.from("suppliers").select("name, phone, vat_number").eq("id", p.supplier_id).single();
    v = need(data, "supplier");
  } else {
    const name = need(p.supplier_name?.trim(), "supplier");
    ref = `supname:${name.toLowerCase()}`.slice(0, 120);
    v = { name, phone: null, vat_number: p.supplier_vat };
  }
  const known = await doneId(ctx, "vendor", ref);
  if (known) return known;
  const r = await qoyod<{ contact?: { id: number } }>(ctx.key, "POST", "/vendors", vendorBody(v));
  const id = need(r.contact?.id, "vendor");
  await remember(ctx, "vendor", "supplier", p.supplier_id ?? p.id, ref, id);
  return id;
}

type InvoiceSource = { reference: string; clientId: string; description: string; line: string; gross: number; vat: number; productId: number; issued: string; due: string };

async function invoiceSource(ctx: Ctx, job: QoyodJobRow): Promise<InvoiceSource> {
  const { admin, s } = ctx;
  if (job.entity_type === "contract_payment") {
    const { data: p } = await admin.from("contract_payments").select("contract_id, seq, label, amount, requested_at, expected_date, created_at").eq("id", job.entity_id).single();
    const pay = need(p, "payment");
    const { data: c } = await admin.from("contracts").select("number, client_id, service, quote_id, quote_version").eq("id", pay.contract_id).single();
    const con = need(c, "contract");
    const { data: v } = await admin.from("quote_versions").select("vat_percent").eq("quote_id", con.quote_id).eq("version", con.quote_version).maybeSingle();
    const { data: inv } = await admin.from("invoices").select("number").eq("payment_id", job.entity_id).maybeSingle();
    return {
      reference: inv?.number ?? invoiceRef(con.number, pay.seq),
      clientId: con.client_id,
      description: `${con.number} — ${pay.label}`,
      line: pay.label,
      gross: Number(pay.amount),
      vat: Number(v?.vat_percent ?? 0),
      productId: need(s.service_products?.[con.service], `product_${con.service}`),
      issued: day(pay.requested_at ?? pay.created_at),
      due: pay.expected_date ?? day(pay.requested_at ?? pay.created_at),
    };
  }
  const { data: a } = await admin.from("addenda").select("number, title, total, vat_percent, contract_id, accepted_at, created_at").eq("id", job.entity_id).single();
  const ad = need(a, "addendum");
  const { data: c } = await admin.from("contracts").select("number, client_id, service").eq("id", ad.contract_id).single();
  const con = need(c, "contract");
  const { data: inv } = await admin.from("invoices").select("number").eq("addendum_id", job.entity_id).maybeSingle();
  return {
    reference: inv?.number ?? ad.number,
    clientId: con.client_id,
    description: `${ad.number} — ${con.number}`,
    line: ad.title,
    gross: Number(ad.total),
    vat: Number(ad.vat_percent ?? 0),
    productId: need(s.addendum_product_id ?? s.service_products?.[con.service], "product_addendum"),
    issued: day(ad.accepted_at ?? ad.created_at),
    due: day(ad.accepted_at ?? ad.created_at),
  };
}

async function runJob(ctx: Ctx, job: QoyodJobRow): Promise<number> {
  const { s } = ctx;
  switch (job.kind) {
    case "invoice": {
      const src = await invoiceSource(ctx, job);
      const inventoryId = need(s.inventory_id, "inventory");
      const contactId = await customerId(ctx, src.clientId);
      const body = invoiceBody({
        contactId, reference: src.reference, description: src.description, issueDate: src.issued, dueDate: src.due, status: s.invoice_status,
        inventoryId, productId: src.productId, lineDescription: src.line, gross: src.gross, vatPercent: src.vat,
      });
      return createOrFind(ctx, "/invoices", "invoices", src.reference, body, (r) => (r.invoice as { id?: number } | undefined)?.id);
    }
    case "invoice_payment": {
      const accountId = need(s.receive_account_id, "receive_account");
      const invoiceJobRef = job.entity_type === "contract_payment" ? `cp:${job.entity_id}` : `ad:${job.entity_id}`;
      const invoiceId = await doneId(ctx, "invoice", invoiceJobRef);
      if (!invoiceId) throw new Blocked("waiting:invoice");
      const src = await invoiceSource(ctx, job);
      const paidSoFar = Number(job.ref.split(":").pop());
      const table = job.entity_type === "contract_payment" ? "contract_payments" : "addenda";
      const { data: row } = await ctx.admin.from(table).select("paid_at").eq("id", job.entity_id).maybeSingle();
      const reference = paymentRef(src.reference, paidSoFar);
      const body = invoicePaymentBody({ reference, invoiceId, accountId, date: day(row?.paid_at ?? null), amount: Number(job.amount ?? 0) });
      return createOrFind(ctx, "/invoice_payments", "invoice_payments", reference, body, (r) => r.id ?? (r.invoice_payment as { id?: number } | undefined)?.id);
    }
    case "bill": {
      const { data: p } = await ctx.admin.from("purchases").select("id, number, supplier_id, supplier_name, supplier_vat, invoice_number, invoice_date, subtotal, vat, total, recorded_at, created_at").eq("id", job.entity_id).single();
      const pur = need(p, "purchase");
      const inventoryId = need(s.inventory_id, "inventory");
      const expenseAccountId = need(s.expense_account_id, "expense_account");
      const contactId = await vendorId(ctx, pur);
      const body = simpleBillBody({
        contactId, reference: pur.number, issueDate: pur.invoice_date ?? day(pur.recorded_at ?? pur.created_at), status: s.invoice_status, inventoryId, expenseAccountId,
        description: pur.invoice_number ? `${pur.number} — ${pur.invoice_number}` : pur.number, subtotal: Number(pur.subtotal), vat: Number(pur.vat), total: Number(pur.total),
      });
      return createOrFind(ctx, "/simple_bills", "simple_bills", pur.number, body, (r) => (r.simple_bill as { id?: number } | undefined)?.id);
    }
    default:
      throw new Blocked("unsupported");
  }
}

/** A fresh (short-lived) link to Qoyod's official invoice PDF. */
export async function qoyodInvoicePdf(orgId: string, invoiceId: number): Promise<string | null> {
  const admin = createAdminClient();
  const { data: key } = await admin.rpc("qoyod_api_key", { p_org: orgId });
  if (!key) return null;
  const r = await qoyod<{ pdf_file?: string }>(key as string, "GET", `/invoices/${invoiceId}/pdf`).catch(() => null);
  const url = r?.pdf_file;
  if (!url) return null;
  try {
    const u = new URL(url);
    // only Qoyod's own hosts (qoyod.com or a subdomain of it), over https
    return u.protocol === "https:" && (u.hostname === "qoyod.com" || u.hostname.endsWith(".qoyod.com")) ? u.toString() : null;
  } catch {
    return null;
  }
}
