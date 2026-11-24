import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { QoyodJobRow, QoyodSettingsRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type QoyodJobItem = Pick<QoyodJobRow, "id" | "kind" | "status" | "attempts" | "last_error" | "qoyod_id" | "amount" | "created_at" | "done_at"> & {
  label: string;
  /** a petty-cash reconcile (the database keeps Qoyod's cash account equal to the real petty-cash balance) */
  opening?: boolean;
  /** a reconcile's accounts, fixed when it was queued (null = the bank account) */
  from_account_id?: number | null;
  to_account_id?: number | null;
};
export type QoyodPageData = {
  settings: Pick<QoyodSettingsRow, "enabled" | "invoice_status" | "inventory_id" | "receive_account_id" | "expense_account_id" | "salary_account_id" | "cash_account_id" | "subcontract_account_id" | "service_products" | "addendum_product_id" | "key_last4" | "key_set_at" | "sync_from">;
  jobs: QoyodJobItem[];
  counts: { queued: number; done: number; failed: number };
  /** invoices sent to Qoyod as drafts whose payments wait: the owner approves them in Qoyod (its API can't) — numbers only with finance.view */
  draftInvoices?: string[];
  /** how many such invoices wait (shown without numbers to settings.manage users without finance.view) */
  draftCount?: number;
  /** may open invoice pages (finance.view) — otherwise invoice numbers are plain text */
  canViewInvoices?: boolean;
  canManage: boolean;
  canRetry: boolean;
};

const EMPTY: QoyodPageData["settings"] = {
  enabled: false, invoice_status: "Draft", inventory_id: null, receive_account_id: null, expense_account_id: null, salary_account_id: null, cash_account_id: null, subcontract_account_id: null, service_products: {}, addendum_product_id: null, key_last4: null, key_set_at: null, sync_from: null,
};

export async function loadQoyod(session: SessionContext): Promise<QoyodPageData> {
  const supabase = await createClient();
  const org = session.organization.id;
  const [{ data: s }, { data: jobs }, ...counts] = await Promise.all([
    supabase.from("qoyod_settings").select("enabled, invoice_status, inventory_id, receive_account_id, expense_account_id, salary_account_id, cash_account_id, subcontract_account_id, service_products, addendum_product_id, key_last4, key_set_at, sync_from").eq("organization_id", org).maybeSingle(),
    supabase.from("qoyod_sync_jobs").select("id, kind, status, attempts, last_error, qoyod_id, amount, created_at, done_at, entity_type, entity_id, from_account_id, to_account_id").eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll", "transfer"]).order("created_at", { ascending: false }).limit(50),
    ...(["queued", "done", "failed"] as const).map((st) =>
      supabase.from("qoyod_sync_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll", "transfer"]).in("status", st === "queued" ? ["queued", "running"] : [st]),
    ),
  ]);
  const rows = jobs ?? [];
  // payments waiting for a draft invoice to be approved in Qoyod (all of them, not only the latest 50)
  const { data: waiting } = await supabase.from("qoyod_sync_jobs").select("entity_type, entity_id").eq("organization_id", org).eq("kind", "invoice_payment").in("status", ["queued", "running"]).eq("last_error", "waiting:invoice_draft").limit(200);
  const waitPay = [...new Set((waiting ?? []).filter((w) => w.entity_type === "contract_payment").map((w) => w.entity_id))];
  const waitAd = [...new Set((waiting ?? []).filter((w) => w.entity_type === "addendum").map((w) => w.entity_id))];
  // invoice numbers are finance documents (RLS: finance.view); without it only the count is shown
  const seeInvoices = can(session, "finance.view");
  const [wp, wa] = await Promise.all([
    seeInvoices && waitPay.length ? supabase.from("invoices").select("number").in("payment_id", waitPay) : Promise.resolve({ data: [] as { number: string }[] }),
    seeInvoices && waitAd.length ? supabase.from("invoices").select("number").in("addendum_id", waitAd) : Promise.resolve({ data: [] as { number: string }[] }),
  ]);
  const draftInvoices = [...new Set([...(wp.data ?? []), ...(wa.data ?? [])].map((i) => i.number))].sort();
  const ids = (t: string) => [...new Set(rows.filter((j) => j.entity_type === t).map((j) => j.entity_id))];
  const [pays, ads, pos, runs, subPays, petty] = await Promise.all([
    ids("contract_payment").length ? supabase.from("contract_payments").select("id, seq, label, contract_id").in("id", ids("contract_payment")) : Promise.resolve({ data: [] }),
    ids("addendum").length ? supabase.from("addenda").select("id, number").in("id", ids("addendum")) : Promise.resolve({ data: [] }),
    ids("purchase").length ? supabase.from("purchases").select("id, number, supplier_name").in("id", ids("purchase")) : Promise.resolve({ data: [] }),
    ids("payroll_run").length ? supabase.from("payroll_runs").select("id, month").in("id", ids("payroll_run")) : Promise.resolve({ data: [] }),
    ids("subcontractor_payment").length ? supabase.from("subcontractor_payments").select("id, paid_on, agreement_id").in("id", ids("subcontractor_payment")) : Promise.resolve({ data: [] }),
    ids("petty_cash").length ? supabase.from("petty_cash_entries").select("id, description, supplier_name").in("id", ids("petty_cash")) : Promise.resolve({ data: [] }),
  ]);
  const agIds = [...new Set(((subPays.data ?? []) as { agreement_id: string }[]).map((p) => p.agreement_id))];
  const { data: ags } = agIds.length ? await supabase.from("subcontractor_agreements").select("id, subcontractor_id").in("id", agIds) : { data: [] };
  const subIds = [...new Set((ags ?? []).map((g) => g.subcontractor_id))];
  const { data: subs } = subIds.length ? await supabase.from("subcontractors").select("id, name").in("id", subIds) : { data: [] };
  const subName = new Map((ags ?? []).map((g) => [g.id, (subs ?? []).find((x) => x.id === g.subcontractor_id)?.name ?? ""]));
  const cids = [...new Set((pays.data ?? []).map((p) => p.contract_id))];
  const { data: cons } = cids.length ? await supabase.from("contracts").select("id, number").in("id", cids) : { data: [] };
  const cnum = new Map((cons ?? []).map((c) => [c.id, c.number]));
  const label = new Map<string, string>([
    ...(pays.data ?? []).map((p) => [p.id, `${cnum.get(p.contract_id) ?? ""}/${p.seq} · ${p.label}`] as [string, string]),
    ...(ads.data ?? []).map((a) => [a.id, a.number] as [string, string]),
    ...(pos.data ?? []).map((p) => [p.id, p.supplier_name ? `${p.number} · ${p.supplier_name}` : p.number] as [string, string]),
    ...((runs.data ?? []) as { id: string; month: string }[]).map((r) => [r.id, r.month.slice(0, 7)] as [string, string]),
    ...((subPays.data ?? []) as { id: string; paid_on: string; agreement_id: string }[]).map((p) => [p.id, `${subName.get(p.agreement_id) ?? ""} · ${p.paid_on}`] as [string, string]),
    ...((petty.data ?? []) as { id: string; description: string; supplier_name: string | null }[]).map((e) => [e.id, e.supplier_name ? `${e.supplier_name} · ${e.description}` : e.description] as [string, string]),
  ]);
  return {
    settings: s ? { ...s, service_products: (s.service_products ?? {}) as Record<string, number> } : EMPTY,
    jobs: rows.map((j) => ({ id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, last_error: j.last_error, qoyod_id: j.qoyod_id, created_at: j.created_at, done_at: j.done_at, amount: j.amount == null ? null : Number(j.amount), label: label.get(j.entity_id) ?? "—", opening: j.entity_type === "petty_cash_opening", ...(j.entity_type === "petty_cash_opening" ? { from_account_id: j.from_account_id, to_account_id: j.to_account_id } : {}) })),
    counts: { queued: counts[0].count ?? 0, done: counts[1].count ?? 0, failed: counts[2].count ?? 0 },
    draftInvoices,
    draftCount: waitPay.length + waitAd.length,
    canManage: can(session, "settings.manage"),
    canViewInvoices: can(session, "finance.view"),
    canRetry: can(session, "settings.manage") || can(session, "finance.manage"),
  };
}
