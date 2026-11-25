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
export const NEEDS_APPROVED_KINDS = ["invoice_payment", "bill_payment", "payroll", "transfer"] as const;
/**
 * The database's `qoyod_claim_jobs` doesn't claim these kinds while sending is "Draft" (the same
 * list, kept in sync by tests/unit/qoyod-petty-r4.test.tsx).
 */
const NEEDS_APPROVED = new Set<string>(NEEDS_APPROVED_KINDS);
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
      // with VAT the line is sent tax-inclusive: Qoyod's total is then exactly the gross amount
      // (a net unit price rounded to 0.01 can't always reproduce it: 0.01 net = 0.0115 gross)
      line_items: [
        i.vatPercent > 0
          ? { product_id: i.productId, description: i.lineDescription, quantity: 1, unit_price: r2(i.gross), tax_percent: i.vatPercent, is_inclusive: true }
          : { product_id: i.productId, description: i.lineDescription, quantity: 1, unit_price: r2(i.gross), tax_percent: 0 },
      ],
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

/**
 * Petty cash (§3.11): a top-up moves money from the bank to the cash account (cash debit ←
 * bank credit), a return moves it back. Journal entries have no reference: the entry's tag in
 * the description is how a retry finds it again.
 */
export function pettyTransferBody(j: { entryId: string; kind: "topup" | "return"; date: string; amount: number; holder: string; bankAccountId: number; cashAccountId: number }) {
  const amount = r2(j.amount);
  const [debit, credit] = j.kind === "topup" ? [j.cashAccountId, j.bankAccountId] : [j.bankAccountId, j.cashAccountId];
  const what = j.kind === "topup" ? "تعبئة عهدة" : "استرجاع عهدة";
  return {
    journal_entry: {
      description: `${pettyTag(j.entryId)} — ${what}: ${j.holder}`.slice(0, 250),
      date: j.date,
      debit_amounts: [{ account_id: debit, amount, comment: what }],
      credit_amounts: [{ account_id: credit, amount, comment: what }],
    },
  };
}
export const pettyTag = (entryId: string) => `[PETTY-${entryId}]`;

/**
 * A petty-cash reconcile (the database's `qoyod_petty_reconcile`): moves petty cash between the
 * bank and a cash account, or from an older cash account to the new one — debit the account it
 * goes to, credit the one it leaves. Tagged with its job id so a retry finds it instead of posting
 * it twice.
 */
export function pettyOpeningBody(j: { jobId: string; date: string; amount: number; fromAccountId: number; toAccountId: number }) {
  const amount = r2(j.amount);
  const what = "تسوية رصيد العهد";
  return {
    journal_entry: {
      description: `${pettyOpeningTag(j.jobId)} — ${what}`.slice(0, 250),
      date: j.date,
      debit_amounts: [{ account_id: j.toAccountId, amount, comment: what }],
      credit_amounts: [{ account_id: j.fromAccountId, amount, comment: what }],
    },
  };
}
export const pettyOpeningTag = (jobId: string) => `[PETTY-OPEN-${jobId}]`;

/**
 * A reconcile job's two accounts, fixed by the database when it was queued (null = the bank
 * account, resolved now). Both the same (an older cash account that has since become the bank
 * account) → nothing to post.
 */
export function pettyReconcileAccounts(
  job: { from_account_id: number | null; to_account_id: number | null },
  bankAccountId: number | null,
): { fromAccountId: number; toAccountId: number } | { skip: true } | { missing: "receive_account" } {
  const from = job.from_account_id ?? bankAccountId;
  const to = job.to_account_id ?? bankAccountId;
  if (from == null || to == null) return { missing: "receive_account" };
  if (from === to) return { skip: true };
  return { fromAccountId: from, toAccountId: to };
}

/** The cash account is never the bank account (the database refuses it): the automatic setup leaves it empty instead. */
export function cashAccountOrNull(cash: number | null, bank: number | null): number | null {
  return cash != null && cash !== bank ? cash : null;
}

/**
 * Which account a petty-cash job posts against — fixed by the database when the job was queued
 * (`qoyod_sync_jobs.route` + `cash_account_id`), never re-decided from the settings when the
 * worker runs:
 * - "bank": no cash account then — petty cash lived in the bank account, so a top-up / return is
 *   a no-op and an expense is paid from the bank. A cash account chosen later doesn't change it;
 *   the reconcile job moves that balance.
 * - "cash": the cash account stored on the job (the reconcile moved it if the settings changed
 *   since). Older rows without one: the current cash account, else wait.
 * A job without a route (older rows) follows the current settings.
 */
export function pettyPlan(
  route: "bank" | "cash" | null,
  s: { receive_account_id: number | null; cash_account_id: number | null },
  jobCashAccountId: number | null = null,
): { post: "bank" } | { post: "cash"; cashAccountId: number } | { wait: "cash_account" } {
  const cashSet = s.cash_account_id != null && s.cash_account_id !== s.receive_account_id;
  const r = route ?? (cashSet ? "cash" : "bank");
  if (r === "bank") return { post: "bank" };
  if (route === "cash" && jobCashAccountId != null) return { post: "cash", cashAccountId: jobCashAccountId };
  return cashSet ? { post: "cash", cashAccountId: s.cash_account_id as number } : { wait: "cash_account" };
}

/**
 * A journal entry we posted earlier, found again by the tag in its description (journal entries
 * have no reference). A failed lookup throws (the job retries later) — posting without knowing
 * could create a duplicate.
 */
export async function findJournalEntry(get: (path: string) => Promise<unknown>, tag: string): Promise<number | null> {
  let r: { journal_entries?: { id: number; description?: string }[] } | null;
  try {
    r = (await get(`/journal_entries?q[description_cont]=${encodeURIComponent(tag)}`)) as typeof r;
  } catch (e) {
    // Qoyod answers a search with no match with 404: that is "not found", not a failure
    if ((e as { status?: unknown } | null)?.status === 404) return null;
    throw e;
  }
  return r?.journal_entries?.find((x) => x.description?.startsWith(tag))?.id ?? null;
}

/** A subcontractor bill's account: subcontracting expense when chosen, else the general expense account. */
export function subcontractExpenseAccount(s: { subcontract_account_id: number | null; expense_account_id: number | null }): number | null {
  return s.subcontract_account_id ?? s.expense_account_id ?? null;
}

/** A success partner's reward bill: the rewards / commissions account when chosen, else the general expense account. */
export function commissionExpenseAccount(s: { commission_account_id?: number | null; expense_account_id: number | null }): number | null {
  return s.commission_account_id ?? s.expense_account_id ?? null;
}

/**
 * VAT on a payment to a subcontractor: only when the company is VAT-registered (its VAT %
 * is > 0) and the subcontractor has a VAT number — the amount paid is then VAT-inclusive.
 */
export function subcontractorBillAmounts(amount: number, companyVatPercent: number, subcontractorVat: string | null | undefined) {
  const total = r2(amount);
  if (!(companyVatPercent > 0) || !subcontractorVat?.trim()) return { subtotal: total, vat: 0, total };
  const subtotal = netOf(total, companyVatPercent);
  return { subtotal, vat: r2(total - subtotal), total };
}

type SetupState = {
  inventory_id: number | null; receive_account_id: number | null; expense_account_id: number | null; addendum_product_id: number | null;
  salary_account_id: number | null; cash_account_id: number | null; subcontract_account_id: number | null;
  commission_account_id?: number | null;
  service_products: Record<string, number> | null; auto_setup_at: string | null;
};
/**
 * Whether the worker should run the automatic Qoyod setup: always when something every
 * invoice/bill needs is missing; otherwise only once, the first time (`auto_setup_at` empty) —
 * the optional accounts (salary, cash, subcontracting) are picked then and never again, so an
 * account the owner cleared stays empty.
 */
export function autoSetupDue(s: SetupState): boolean {
  const p = s.service_products ?? {};
  if (!s.inventory_id || !s.receive_account_id || !s.expense_account_id || !s.addendum_product_id || !p.gypsum || !p.interior || !p.exterior) return true;
  return !s.auto_setup_at;
}

type AutoPicked = Omit<SetupState, "auto_setup_at" | "service_products"> & { service_products: Record<string, number> };
/**
 * The settings after an automatic setup: only empty settings are filled (the owner's choices
 * stay). Required ones whenever empty; the optional accounts (salary, cash, subcontracting) only
 * at the first setup (`auto_setup_at` empty) — after that an empty one is the owner's choice.
 * The cash account is never the bank account.
 */
export function autoSetupNext(cur: Partial<SetupState> | null | undefined, auto: AutoPicked): AutoPicked {
  const first = !cur?.auto_setup_at;
  const receive = cur?.receive_account_id ?? auto.receive_account_id;
  const optional = (k: "salary_account_id" | "cash_account_id" | "subcontract_account_id" | "commission_account_id") => cur?.[k] ?? (first ? (auto[k] ?? null) : null);
  return {
    inventory_id: cur?.inventory_id ?? auto.inventory_id,
    receive_account_id: receive,
    expense_account_id: cur?.expense_account_id ?? auto.expense_account_id,
    salary_account_id: optional("salary_account_id"),
    cash_account_id: cashAccountOrNull(optional("cash_account_id"), receive),
    subcontract_account_id: optional("subcontract_account_id"),
    commission_account_id: optional("commission_account_id"),
    service_products: { ...auto.service_products, ...(cur?.service_products ?? {}) },
    addendum_product_id: cur?.addendum_product_id ?? auto.addendum_product_id,
  };
}
export const billPaymentRef = (purchaseNumber: string) => `${purchaseNumber}/PAID`;
/** Subcontractor payments and petty-cash expenses have no document number: a short, unique id. */
const shortId = (uuid: string) => uuid.replace(/-/g, "").slice(0, 12).toUpperCase();
export const subcontractorBillRef = (paymentId: string) => `SUB-${shortId(paymentId)}`;
export const pettyBillRef = (entryId: string) => `PC-${shortId(entryId)}`;
/** A reward paid to a success partner: its payment voucher number (PV-…) is the bill's reference. */
export const commissionBillRef = (voucherNumber: string) => voucherNumber;
/** The vendor used for petty-cash expenses with no supplier name on the receipt. */
export const PETTY_VENDOR = "مصروفات نثرية";

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
