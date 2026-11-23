/**
 * Qoyod (https://apidoc.qoyod.com, API v2) request bodies — pure functions so
 * they can be unit-tested. Field names follow the official docs exactly.
 */

export const QOYOD_BASE = "https://api.qoyod.com/2.0";

/** Qoyod's default taxes: 1 = 15 % VAT, 2 = 0 % VAT, 3 = exempt. */
export const TAX = { vat15: "1", zero: "2", exempt: "3" } as const;

/**
 * Jobs that can't be posted on a draft document in Qoyod (a draft invoice/bill can't be paid;
 * a journal entry posts at once): they wait until sending is "Approved".
 */
const NEEDS_APPROVED = new Set(["invoice_payment", "bill_payment", "payroll"]);
export function waitsForApproved(kind: string, invoiceStatus: string | null | undefined): boolean {
  return NEEDS_APPROVED.has(kind) && invoiceStatus !== "Approved";
}

/** A document's status from Qoyod's GET /invoices/:id or /simple_bills/:id answer. */
export function documentStatus(r: unknown, key: "invoice" | "simple_bill"): string | null {
  const doc = (r as Record<string, { status?: unknown } | undefined> | null)?.[key];
  return typeof doc?.status === "string" ? doc.status : null;
}

/** PATCH /simple_bills/:id — approve a simple bill we sent as a draft. */
export function approveSimpleBillBody() {
  return { simple_bill: { status: "Approved" } };
}

/**
 * Before paying a document we may have sent as a draft (sending was "Draft" then): a draft simple
 * bill is approved through the API first; Qoyod's API has no way to approve an existing invoice,
 * so its payment waits until the owner approves it in Qoyod ("waiting:invoice_draft").
 */
export function paymentStep(kind: "invoice_payment" | "bill_payment", docStatus: string | null): "post" | "approve" | "wait" {
  if (docStatus !== "Draft") return "post";
  return kind === "bill_payment" ? "approve" : "wait";
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** 9665XXXXXXXX → 05XXXXXXXX (the format Qoyod shows); anything else unchanged. */
export function localPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return phone.startsWith("966") ? `0${phone.slice(3)}` : phone;
}

/** Amount before VAT from a VAT-inclusive amount. */
export function netOf(gross: number, vatPercent: number): number {
  return vatPercent > 0 ? r2(gross / (1 + vatPercent / 100)) : r2(gross);
}

export function customerBody(c: { name: string; phone: string | null; city: string | null; number: string }) {
  return {
    contact: {
      name: c.name,
      organization: "",
      phone_number: localPhone(c.phone),
      status: "Active",
      billing_address: c.city ? { billing_city: c.city, billing_country: "Saudi Arabia" } : undefined,
    },
  };
}

export function vendorBody(v: { name: string; phone: string | null; vat_number: string | null }) {
  return { contact: { name: v.name, phone_number: localPhone(v.phone), tax_number: v.vat_number ?? undefined, status: "Active" } };
}

export type InvoiceInput = {
  contactId: number;
  reference: string;
  description: string;
  issueDate: string;
  dueDate: string;
  status: "Draft" | "Approved";
  inventoryId: number;
  productId: number;
  lineDescription: string;
  /** VAT-inclusive amount the client owes for this line. */
  gross: number;
  vatPercent: number;
};

export function invoiceBody(i: InvoiceInput) {
  return {
    invoice: {
      contact_id: i.contactId,
      reference: i.reference,
      description: i.description,
      issue_date: i.issueDate,
      due_date: i.dueDate < i.issueDate ? i.issueDate : i.dueDate,
      status: i.status,
      inventory_id: i.inventoryId,
      line_items: [{ product_id: i.productId, description: i.lineDescription, quantity: 1, unit_price: netOf(i.gross, i.vatPercent), tax_percent: i.vatPercent }],
    },
  };
}

export function invoicePaymentBody(p: { reference: string; invoiceId: number; accountId: number; date: string; amount: number }) {
  return { invoice_payment: { reference: p.reference, invoice_id: p.invoiceId, account_id: p.accountId, date: p.date, amount: r2(p.amount) } };
}

export function simpleBillBody(b: {
  contactId: number; reference: string; issueDate: string; status: "Draft" | "Approved"; inventoryId: number; expenseAccountId: number;
  description: string; subtotal: number; vat: number; total: number;
}) {
  // with VAT on the supplier invoice: net amount + 15 %; without: the whole amount, no VAT
  const withVat = b.vat > 0;
  return {
    simple_bill: {
      contact_id: b.contactId,
      status: b.status,
      issue_date: b.issueDate,
      reference: b.reference,
      inventory_id: b.inventoryId,
      simple_bill_items_attributes: [
        { expense_category_id: b.expenseAccountId, description: b.description, total_amount: r2(withVat ? b.subtotal : b.total), tax_id: withVat ? TAX.vat15 : TAX.zero },
      ],
    },
  };
}

export function simpleBillPaymentBody(p: { reference: string; billId: number; accountId: number; date: string; amount: number; description: string }) {
  return { simple_bill_payment: { reference: p.reference, description: p.description, simple_bill_id: String(p.billId), account_id: String(p.accountId), date: p.date, amount: r2(p.amount).toFixed(2) } };
}

/**
 * Payroll (§3.20) as a journal entry: salaries expense (debit) ← bank (credit) for the
 * net salaries paid. The month tag in the description is how a retry finds it again
 * (journal entries have no reference field in Qoyod).
 */
export function payrollJournalBody(j: { month: string; date: string; net: number; employees: number; salaryAccountId: number; bankAccountId: number }) {
  const amount = r2(j.net);
  return {
    journal_entry: {
      description: payrollTag(j.month) + ` — رواتب ${j.month} (${j.employees} موظف)`,
      date: j.date,
      debit_amounts: [{ account_id: j.salaryAccountId, amount, comment: `صافي رواتب ${j.month}` }],
      credit_amounts: [{ account_id: j.bankAccountId, amount, comment: `صرف رواتب ${j.month}` }],
    },
  };
}
export const payrollTag = (month: string) => `[PAYROLL-${month}]`;
export const billPaymentRef = (purchaseNumber: string) => `${purchaseNumber}/PAID`;

/** Readable, unique references in Qoyod (C-2026-001 payment 2 → "C-2026-001/2"). */
export const invoiceRef = (contractNumber: string, seq: number) => `${contractNumber}/${seq}`;
export const paymentRef = (invoiceReference: string, paidSoFar: number) => `${invoiceReference}/PAY-${r2(paidSoFar).toFixed(2)}`;

/** Pull a short, log-safe message out of a Qoyod error body. */
export function errorText(status: number, body: unknown): string {
  let msg = "";
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const e = b.errors ?? b.error ?? b.message;
    msg = typeof e === "string" ? e : e ? JSON.stringify(e) : "";
  } else if (typeof body === "string") msg = body;
  return `HTTP ${status}${msg ? `: ${msg}` : ""}`.slice(0, 300);
}
