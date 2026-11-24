import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QoyodJobRow, QoyodSettingsRow } from "@/lib/supabase/database.types";
import { qoyod, QoyodError } from "./client";
import { qoyodAutoSetup } from "./setup";
import { effectiveVatPercent } from "@/lib/costing";
import { approveSimpleBillBody, autoSetupDue, billPaymentRef, customerBody, documentStatus, invoiceBody, invoicePaymentBody, invoiceRef, paymentRef, paymentStep, findJournalEntry, payrollJournalBody, payrollTag, PETTY_VENDOR, pettyBillRef, pettyOpeningBody, pettyOpeningTag, pettyTag, pettyTransferBody, pettyTransferSkip, simpleBillBody, simpleBillPaymentBody, subcontractExpenseAccount, subcontractorBillAmounts, subcontractorBillRef, vendorBody, waitsForApproved } from "./payloads";

type Admin = ReturnType<typeof createAdminClient>;
type Ctx = { admin: Admin; key: string; s: QoyodSettingsRow };

/** Jobs that can't run yet (missing setting, waiting for the invoice) carry a code the settings page explains. */
class Blocked extends Error {}
/** Not an error: the job waits (e.g. for sending to be switched to "Approved") without using up its tries. */
class Deferred extends Error {}

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
      // a job with nothing to post (e.g. a petty-cash transfer within one account) is done with its reason
      const skipped = typeof id === "object" ? id.skipped : null;
      await admin.from("qoyod_sync_jobs").update({ status: "done", qoyod_id: skipped ? null : (id as number), done_at: new Date().toISOString(), last_error: skipped ? `skipped:${skipped}` : null }).eq("id", job.id);
      result.done++;
    } catch (e) {
      if (e instanceof Deferred) {
        await admin.rpc("qoyod_defer_job", { p_job: job.id, p_minutes: 720, p_reason: e.message });
        continue;
      }
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

/**
 * Something we create ourselves is missing (e.g. a service product) → prepare it in Qoyod now.
 * Only optional accounts empty (salary, cash, subcontracting) → retried at most once a day.
 */
async function fillMissing(admin: Admin, key: string, s: QoyodSettingsRow): Promise<QoyodSettingsRow> {
  const products = s.service_products ?? {};
  if (!autoSetupDue(s)) return s;
  const attempt = new Date().toISOString();
  await admin.from("qoyod_settings").update({ auto_setup_at: attempt }).eq("organization_id", s.organization_id);
  s = { ...s, auto_setup_at: attempt };
  try {
    const { data: org } = await admin.from("organizations").select("vat_number").eq("id", s.organization_id).single();
    const auto = await qoyodAutoSetup(key, !!org?.vat_number);
    const next = {
      inventory_id: s.inventory_id ?? auto.inventory_id, receive_account_id: s.receive_account_id ?? auto.receive_account_id, expense_account_id: s.expense_account_id ?? auto.expense_account_id,
      salary_account_id: s.salary_account_id ?? auto.salary_account_id, cash_account_id: s.cash_account_id ?? auto.cash_account_id,
      subcontract_account_id: s.subcontract_account_id ?? auto.subcontract_account_id,
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

async function remember(ctx: Ctx, kind: "customer" | "vendor", entityType: "client" | "supplier" | "subcontractor", entityId: string, ref: string, id: number) {
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

/** A subcontractor is a vendor in Qoyod too (created on demand, remembered). */
async function subcontractorVendorId(ctx: Ctx, subcontractorId: string): Promise<number> {
  const ref = `sub:${subcontractorId}`;
  const known = await doneId(ctx, "vendor", ref);
  if (known) return known;
  const { data } = await ctx.admin.from("subcontractors").select("name, phone, vat_number").eq("id", subcontractorId).single();
  const r = await qoyod<{ contact?: { id: number } }>(ctx.key, "POST", "/vendors", vendorBody(need(data, "subcontractor")));
  const id = need(r.contact?.id, "vendor");
  await remember(ctx, "vendor", "subcontractor", subcontractorId, ref, id);
  return id;
}

/**
 * What a "bill" job sends: a supplier purchase, a payment to a subcontractor (subcontracting
 * expense; VAT-inclusive when both sides are VAT-registered) or a petty-cash expense (expense
 * account; petty-cash entries record no VAT, so none is claimed).
 */
type BillSource = { reference: string; contactId: number; issueDate: string; expenseAccountId: number; description: string; subtotal: number; vat: number; total: number };

/** The company's VAT % — 0 without a VAT number (§3.3). */
async function companyVatPercent(ctx: Ctx): Promise<number> {
  const [{ data: org }, { data: ps }] = await Promise.all([
    ctx.admin.from("organizations").select("vat_number").eq("id", ctx.s.organization_id).maybeSingle(),
    ctx.admin.from("pricing_settings").select("vat_percent").eq("organization_id", ctx.s.organization_id).maybeSingle(),
  ]);
  return effectiveVatPercent(org?.vat_number, Number(ps?.vat_percent ?? 15));
}

async function billSource(ctx: Ctx, job: QoyodJobRow): Promise<BillSource> {
  const { admin, s } = ctx;
  if (job.entity_type === "subcontractor_payment") {
    const { data: p } = await admin.from("subcontractor_payments").select("id, agreement_id, paid_on, amount, reference, note").eq("id", job.entity_id).single();
    const pay = need(p, "subcontractor_payment");
    const { data: g } = await admin.from("subcontractor_agreements").select("subcontractor_id, contract_id, scope").eq("id", pay.agreement_id).single();
    const agr = need(g, "agreement");
    const { data: c } = await admin.from("contracts").select("number").eq("id", agr.contract_id).maybeSingle();
    // the subcontracting account when chosen, else the general expense account
    const expenseAccountId = need(subcontractExpenseAccount(s), "expense_account");
    const contactId = await subcontractorVendorId(ctx, agr.subcontractor_id);
    const [{ data: sub }, vatPercent] = await Promise.all([
      admin.from("subcontractors").select("vat_number").eq("id", agr.subcontractor_id).maybeSingle(),
      companyVatPercent(ctx),
    ]);
    // VAT-registered company + subcontractor with a VAT number: the amount paid includes VAT
    const amounts = subcontractorBillAmounts(Number(pay.amount), vatPercent, sub?.vat_number);
    return {
      reference: subcontractorBillRef(pay.id), contactId, issueDate: pay.paid_on, expenseAccountId,
      description: [c?.number, agr.scope, pay.reference].filter(Boolean).join(" — ").slice(0, 250), ...amounts,
    };
  }
  if (job.entity_type === "petty_cash") {
    const { data: e } = await admin.from("petty_cash_entries").select("id, entry_date, amount, description, supplier_name, contract_id").eq("id", job.entity_id).single();
    const entry = need(e, "petty_cash");
    const { data: c } = entry.contract_id ? await admin.from("contracts").select("number").eq("id", entry.contract_id).maybeSingle() : { data: null };
    const expenseAccountId = need(s.expense_account_id, "expense_account");
    const contactId = await vendorId(ctx, { supplier_id: null, supplier_name: entry.supplier_name?.trim() || PETTY_VENDOR, supplier_vat: null, id: entry.id });
    const amount = Number(entry.amount);
    return {
      reference: pettyBillRef(entry.id), contactId, issueDate: entry.entry_date, expenseAccountId,
      description: [c?.number, entry.description].filter(Boolean).join(" — ").slice(0, 250), subtotal: amount, vat: 0, total: amount,
    };
  }
  const { data: p } = await admin.from("purchases").select("id, number, supplier_id, supplier_name, supplier_vat, invoice_number, invoice_date, subtotal, vat, total, recorded_at, created_at").eq("id", job.entity_id).single();
  const pur = need(p, "purchase");
  const expenseAccountId = need(s.expense_account_id, "expense_account");
  const contactId = await vendorId(ctx, pur);
  return {
    reference: pur.number, contactId, issueDate: pur.invoice_date ?? day(pur.recorded_at ?? pur.created_at), expenseAccountId,
    description: pur.invoice_number ? `${pur.number} — ${pur.invoice_number}` : pur.number, subtotal: Number(pur.subtotal), vat: Number(pur.vat), total: Number(pur.total),
  };
}

/** The bill job a payment belongs to, and how/when it was paid. */
async function billPayment(ctx: Ctx, job: QoyodJobRow): Promise<{ billRef: string; reference: string; from: "bank" | "cash"; date: string; amount: number; description: string }> {
  const { admin } = ctx;
  if (job.entity_type === "subcontractor_payment") {
    const { data: p } = await admin.from("subcontractor_payments").select("id, paid_on, amount, method, reference").eq("id", job.entity_id).single();
    const pay = need(p, "subcontractor_payment");
    const ref = subcontractorBillRef(pay.id);
    return { billRef: `sb:${pay.id}`, reference: billPaymentRef(ref), from: pay.method === "cash" ? "cash" : "bank", date: pay.paid_on, amount: Number(job.amount ?? pay.amount), description: pay.reference ? `${ref} — ${pay.reference}` : ref };
  }
  if (job.entity_type === "petty_cash") {
    const { data: e } = await admin.from("petty_cash_entries").select("id, entry_date, amount").eq("id", job.entity_id).single();
    const entry = need(e, "petty_cash");
    const ref = pettyBillRef(entry.id);
    // petty cash is cash in the holder's hands
    return { billRef: `pc:${entry.id}`, reference: billPaymentRef(ref), from: "cash", date: entry.entry_date, amount: Number(job.amount ?? entry.amount), description: ref };
  }
  const { data: p } = await admin.from("purchases").select("number, paid_on, paid_from, paid_reference, total").eq("id", job.entity_id).single();
  const pur = need(p, "purchase");
  return {
    billRef: `po:${job.entity_id}`, reference: billPaymentRef(pur.number), from: pur.paid_from === "cash" ? "cash" : "bank", date: pur.paid_on ?? today(),
    amount: Number(job.amount ?? pur.total), description: pur.paid_reference ? `${pur.number} — ${pur.paid_reference}` : pur.number,
  };
}

type InvoiceSource = { reference: string; clientId: string; description: string; line: string; gross: number; vat: number; productId: number; issued: string; due: string };

async function invoiceSource(ctx: Ctx, job: QoyodJobRow): Promise<InvoiceSource> {
  const { admin, s } = ctx;
  if (job.entity_type === "contract_payment") {
    const { data: p } = await admin.from("contract_payments").select("contract_id, seq, label, amount, requested_at, expected_date, created_at").eq("id", job.entity_id).single();
    const pay = need(p, "payment");
    const { data: c } = await admin.from("contracts").select("number, client_id, service").eq("id", pay.contract_id).single();
    const con = need(c, "contract");
    // VAT exactly as on the app's own invoice (0 % without a company VAT number at issue)
    const { data: inv } = await admin.from("invoices").select("number, kind, vat_percent").eq("payment_id", job.entity_id).maybeSingle();
    return {
      reference: inv?.number ?? invoiceRef(con.number, pay.seq),
      clientId: con.client_id,
      description: `${con.number} — ${pay.label}`,
      line: pay.label,
      gross: Number(pay.amount),
      vat: inv?.kind === "tax" ? Number(inv.vat_percent ?? 0) : 0,
      productId: need(s.service_products?.[con.service], `product_${con.service}`),
      issued: day(pay.requested_at ?? pay.created_at),
      due: pay.expected_date ?? day(pay.requested_at ?? pay.created_at),
    };
  }
  const { data: a } = await admin.from("addenda").select("number, title, total, contract_id, accepted_at, created_at").eq("id", job.entity_id).single();
  const ad = need(a, "addendum");
  const { data: c } = await admin.from("contracts").select("number, client_id, service").eq("id", ad.contract_id).single();
  const con = need(c, "contract");
  const { data: inv } = await admin.from("invoices").select("number, kind, vat_percent").eq("addendum_id", job.entity_id).maybeSingle();
  return {
    reference: inv?.number ?? ad.number,
    clientId: con.client_id,
    description: `${ad.number} — ${con.number}`,
    line: ad.title,
    gross: Number(ad.total),
    vat: inv?.kind === "tax" ? Number(inv.vat_percent ?? 0) : 0,
    productId: need(s.addendum_product_id ?? s.service_products?.[con.service], "product_addendum"),
    issued: day(ad.accepted_at ?? ad.created_at),
    due: day(ad.accepted_at ?? ad.created_at),
  };
}

/** Journal entries we posted earlier, found by their tag; a failed lookup throws (retried later, never a duplicate). */
const journalEntry = (ctx: Ctx, tag: string) => findJournalEntry((path) => qoyod<unknown>(ctx.key, "GET", path), tag);

async function runJob(ctx: Ctx, job: QoyodJobRow): Promise<number | { skipped: string }> {
  const { s } = ctx;
  // payments on draft invoices/bills and journal entries wait until sending is "Approved"
  if (waitsForApproved(job.kind, s.invoice_status)) throw new Deferred("waiting:approved");
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
      // an invoice sent while sending was "Draft" can't be paid, and the API can't approve it:
      // the payment waits until the owner approves it in Qoyod (listed on /settings/qoyod)
      const invoice = await qoyod<unknown>(ctx.key, "GET", `/invoices/${invoiceId}`);
      if (paymentStep("invoice_payment", documentStatus(invoice, "invoice")) === "wait") throw new Deferred("waiting:invoice_draft");
      const src = await invoiceSource(ctx, job);
      const paidSoFar = Number(job.ref.split(":").pop());
      const table = job.entity_type === "contract_payment" ? "contract_payments" : "addenda";
      const { data: row } = await ctx.admin.from(table).select("paid_at").eq("id", job.entity_id).maybeSingle();
      const reference = paymentRef(src.reference, paidSoFar);
      const body = invoicePaymentBody({ reference, invoiceId, accountId, date: day(row?.paid_at ?? null), amount: Number(job.amount ?? 0) });
      return createOrFind(ctx, "/invoice_payments", "invoice_payments", reference, body, (r) => r.id ?? (r.invoice_payment as { id?: number } | undefined)?.id);
    }
    case "bill": {
      const inventoryId = need(s.inventory_id, "inventory");
      const b = await billSource(ctx, job);
      const body = simpleBillBody({
        contactId: b.contactId, reference: b.reference, issueDate: b.issueDate, status: s.invoice_status, inventoryId, expenseAccountId: b.expenseAccountId,
        description: b.description, subtotal: b.subtotal, vat: b.vat, total: b.total,
      });
      return createOrFind(ctx, "/simple_bills", "simple_bills", b.reference, body, (r) => (r.simple_bill as { id?: number } | undefined)?.id);
    }
    case "bill_payment": {
      const pay = await billPayment(ctx, job);
      const billId = await doneId(ctx, "bill", pay.billRef);
      if (!billId) throw new Blocked("waiting:bill");
      // a simple bill sent while sending was "Draft" is approved first (the API allows it for bills)
      const bill = await qoyod<unknown>(ctx.key, "GET", `/simple_bills/${billId}`);
      if (paymentStep("bill_payment", documentStatus(bill, "simple_bill")) === "approve") {
        await qoyod(ctx.key, "PATCH", `/simple_bills/${billId}`, approveSimpleBillBody());
      }
      const accountId = pay.from === "cash" ? need(s.cash_account_id ?? s.receive_account_id, "cash_account") : need(s.receive_account_id, "receive_account");
      const body = simpleBillPaymentBody({ reference: pay.reference, billId, accountId, date: pay.date, amount: pay.amount, description: pay.description });
      return createOrFind(ctx, "/simple_bill_payments", "simple_bill_payments", pay.reference, body, (r) => (r.payment as { id?: number } | undefined)?.id ?? (r.simple_bill_payment as { id?: number } | undefined)?.id);
    }
    case "payroll": {
      const salaryAccountId = need(s.salary_account_id, "salary_account");
      const bankAccountId = need(s.receive_account_id, "receive_account");
      const { data: run } = await ctx.admin.from("payroll_runs").select("month, paid_on").eq("id", job.entity_id).single();
      const r = need(run, "payroll");
      const { count } = await ctx.admin.from("payroll_lines").select("id", { count: "exact", head: true }).eq("run_id", job.entity_id);
      const month = r.month.slice(0, 7);
      const tag = payrollTag(month);
      // found again by its month tag if an earlier try reached Qoyod
      const hit = await journalEntry(ctx, tag);
      if (hit) return hit;
      const body = payrollJournalBody({ month, date: r.paid_on ?? today(), net: Number(job.amount ?? 0), employees: count ?? 0, salaryAccountId, bankAccountId });
      const created = await qoyod<{ id?: number; journal_entry?: { id?: number } }>(ctx.key, "POST", "/journal_entries", body);
      const id = Number(created.id ?? created.journal_entry?.id);
      if (!id) throw new QoyodError(500, "no id returned");
      return id;
    }
    case "transfer": {
      // petty cash top-up (bank → cash) or return (cash → bank)
      const bankAccountId = need(s.receive_account_id, "receive_account");
      if (job.entity_type === "petty_cash_opening") {
        // a cash account chosen later: the open petty-cash balance moves bank → cash once
        const skip = pettyTransferSkip(s);
        if (skip) return { skipped: skip };
        const cashAccountId = need(s.cash_account_id, "cash_account");
        const hit = await journalEntry(ctx, pettyOpeningTag(job.id));
        if (hit) return hit;
        const body = pettyOpeningBody({ jobId: job.id, date: day(job.created_at), amount: Number(job.amount ?? 0), bankAccountId, cashAccountId });
        const created = await qoyod<{ id?: number; journal_entry?: { id?: number } }>(ctx.key, "POST", "/journal_entries", body);
        const id = Number(created.id ?? created.journal_entry?.id);
        if (!id) throw new QoyodError(500, "no id returned");
        return id;
      }
      const { data: e } = await ctx.admin.from("petty_cash_entries").select("id, kind, entry_date, amount, account_id").eq("id", job.entity_id).single();
      const entry = need(e, "petty_cash");
      if (entry.kind === "expense") throw new Blocked("unsupported");
      // no cash account: petty cash is paid from the bank account, so there is nothing to move
      const skip = pettyTransferSkip(s);
      if (skip) return { skipped: skip };
      const cashAccountId = need(s.cash_account_id, "cash_account");
      const { data: acc } = await ctx.admin.from("petty_cash_accounts").select("name").eq("id", entry.account_id).maybeSingle();
      const tag = pettyTag(entry.id);
      const hit = await journalEntry(ctx, tag);
      if (hit) return hit;
      const body = pettyTransferBody({ entryId: entry.id, kind: entry.kind, date: entry.entry_date, amount: Number(job.amount ?? entry.amount), holder: acc?.name ?? "", bankAccountId, cashAccountId });
      const created = await qoyod<{ id?: number; journal_entry?: { id?: number } }>(ctx.key, "POST", "/journal_entries", body);
      const id = Number(created.id ?? created.journal_entry?.id);
      if (!id) throw new QoyodError(500, "no id returned");
      return id;
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
