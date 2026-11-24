import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { QoyodJobRow, QoyodSettingsRow } from "@/lib/supabase/database.types";
import { once, rows } from "@/lib/data/query";
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
  const seeInvoices = can(session, "finance.view");
  const jobsP = once(supabase.from("qoyod_sync_jobs").select("id, kind, status, attempts, last_error, qoyod_id, amount, created_at, done_at, entity_type, entity_id, from_account_id, to_account_id").eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll", "transfer"]).order("created_at", { ascending: false }).limit(50));
  // payments waiting for a draft invoice to be approved in Qoyod (all of them, not only the latest 50)
  const waitingP = once(supabase.from("qoyod_sync_jobs").select("entity_type, entity_id").eq("organization_id", org).eq("kind", "invoice_payment").in("status", ["queued", "running"]).eq("last_error", "waiting:invoice_draft").limit(200));
  const waitIds = waitingP.then(({ data: waiting }) => ({
    pay: [...new Set((waiting ?? []).filter((w) => w.entity_type === "contract_payment").map((w) => w.entity_id))],
    ad: [...new Set((waiting ?? []).filter((w) => w.entity_type === "addendum").map((w) => w.entity_id))],
  }));
  // what each job is about, for its label (chained onto the jobs: payments → contracts, subcontractor payments → agreements → names)
  const entitiesP = jobsP.then(({ data: jobs }) => {
    const ids = (t: string) => [...new Set((jobs ?? []).filter((j) => j.entity_type === t).map((j) => j.entity_id))];
    const paysP = ids("contract_payment").length ? rows(supabase.from("contract_payments").select("id, seq, label, contract_id").in("id", ids("contract_payment"))) : Promise.resolve([]);
    const subPaysP = ids("subcontractor_payment").length ? rows(supabase.from("subcontractor_payments").select("id, paid_on, agreement_id").in("id", ids("subcontractor_payment"))) : Promise.resolve([]);
    return Promise.all([
      paysP,
      ids("addendum").length ? rows(supabase.from("addenda").select("id, number").in("id", ids("addendum"))) : [],
      ids("purchase").length ? rows(supabase.from("purchases").select("id, number, supplier_name").in("id", ids("purchase"))) : [],
      ids("payroll_run").length ? rows(supabase.from("payroll_runs").select("id, month").in("id", ids("payroll_run"))) : [],
      subPaysP,
      ids("petty_cash").length ? rows(supabase.from("petty_cash_entries").select("id, description, supplier_name").in("id", ids("petty_cash"))) : [],
      paysP.then((pays) => {
        const cids = [...new Set(pays.map((p) => p.contract_id))];
        return cids.length ? rows(supabase.from("contracts").select("id, number").in("id", cids)) : [];
      }),
      subPaysP.then(async (subPays) => {
        const agIds = [...new Set(subPays.map((p) => p.agreement_id))];
        const ags = agIds.length ? await rows(supabase.from("subcontractor_agreements").select("id, subcontractor_id").in("id", agIds)) : [];
        const subIds = [...new Set(ags.map((g) => g.subcontractor_id))];
        const subs = subIds.length ? await rows(supabase.from("subcontractors").select("id, name").in("id", subIds)) : [];
        return new Map(ags.map((g) => [g.id, subs.find((x) => x.id === g.subcontractor_id)?.name ?? ""]));
      }),
    ]);
  });
  const [{ data: s }, { data: jobs }, { pay: waitPay, ad: waitAd }, [wp, wa], [pays, ads, pos, runs, subPays, petty, cons, subName], ...counts] = await Promise.all([
    supabase.from("qoyod_settings").select("enabled, invoice_status, inventory_id, receive_account_id, expense_account_id, salary_account_id, cash_account_id, subcontract_account_id, service_products, addendum_product_id, key_last4, key_set_at, sync_from").eq("organization_id", org).maybeSingle(),
    jobsP,
    waitIds,
    // invoice numbers are finance documents (RLS: finance.view); without it only the count is shown
    waitIds.then(({ pay, ad }) =>
      Promise.all([
        seeInvoices && pay.length ? rows(supabase.from("invoices").select("number").in("payment_id", pay)) : Promise.resolve([] as { number: string }[]),
        seeInvoices && ad.length ? rows(supabase.from("invoices").select("number").in("addendum_id", ad)) : Promise.resolve([] as { number: string }[]),
      ]),
    ),
    entitiesP,
    ...(["queued", "done", "failed"] as const).map((st) =>
      supabase.from("qoyod_sync_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll", "transfer"]).in("status", st === "queued" ? ["queued", "running"] : [st]),
    ),
  ]);
  const jobRows = jobs ?? [];
  const draftInvoices = [...new Set([...wp, ...wa].map((i) => i.number))].sort();
  const cnum = new Map(cons.map((c) => [c.id, c.number]));
  const label = new Map<string, string>([
    ...pays.map((p) => [p.id, `${cnum.get(p.contract_id) ?? ""}/${p.seq} · ${p.label}`] as [string, string]),
    ...ads.map((a) => [a.id, a.number] as [string, string]),
    ...pos.map((p) => [p.id, p.supplier_name ? `${p.number} · ${p.supplier_name}` : p.number] as [string, string]),
    ...runs.map((r) => [r.id, r.month.slice(0, 7)] as [string, string]),
    ...subPays.map((p) => [p.id, `${subName.get(p.agreement_id) ?? ""} · ${p.paid_on}`] as [string, string]),
    ...petty.map((e) => [e.id, e.supplier_name ? `${e.supplier_name} · ${e.description}` : e.description] as [string, string]),
  ]);
  return {
    settings: s ? { ...s, service_products: (s.service_products ?? {}) as Record<string, number> } : EMPTY,
    jobs: jobRows.map((j) => ({ id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, last_error: j.last_error, qoyod_id: j.qoyod_id, created_at: j.created_at, done_at: j.done_at, amount: j.amount == null ? null : Number(j.amount), label: label.get(j.entity_id) ?? "—", opening: j.entity_type === "petty_cash_opening", ...(j.entity_type === "petty_cash_opening" ? { from_account_id: j.from_account_id, to_account_id: j.to_account_id } : {}) })),
    counts: { queued: counts[0].count ?? 0, done: counts[1].count ?? 0, failed: counts[2].count ?? 0 },
    draftInvoices,
    draftCount: waitPay.length + waitAd.length,
    canManage: can(session, "settings.manage"),
    canViewInvoices: can(session, "finance.view"),
    canRetry: can(session, "settings.manage") || can(session, "finance.manage"),
  };
}
