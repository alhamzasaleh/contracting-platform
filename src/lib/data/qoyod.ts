import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import type { QoyodJobRow, QoyodSettingsRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type QoyodJobItem = Pick<QoyodJobRow, "id" | "kind" | "status" | "attempts" | "last_error" | "qoyod_id" | "amount" | "created_at" | "done_at"> & { label: string };
export type QoyodPageData = {
  settings: Pick<QoyodSettingsRow, "enabled" | "invoice_status" | "inventory_id" | "receive_account_id" | "expense_account_id" | "salary_account_id" | "cash_account_id" | "service_products" | "addendum_product_id" | "key_last4" | "key_set_at" | "sync_from">;
  jobs: QoyodJobItem[];
  counts: { queued: number; done: number; failed: number };
  canManage: boolean;
  canRetry: boolean;
};

const EMPTY: QoyodPageData["settings"] = {
  enabled: false, invoice_status: "Draft", inventory_id: null, receive_account_id: null, expense_account_id: null, salary_account_id: null, cash_account_id: null, service_products: {}, addendum_product_id: null, key_last4: null, key_set_at: null, sync_from: null,
};

export async function loadQoyod(session: SessionContext): Promise<QoyodPageData> {
  const supabase = await createClient();
  const org = session.organization.id;
  const [{ data: s }, { data: jobs }, ...counts] = await Promise.all([
    supabase.from("qoyod_settings").select("enabled, invoice_status, inventory_id, receive_account_id, expense_account_id, salary_account_id, cash_account_id, service_products, addendum_product_id, key_last4, key_set_at, sync_from").eq("organization_id", org).maybeSingle(),
    supabase.from("qoyod_sync_jobs").select("id, kind, status, attempts, last_error, qoyod_id, amount, created_at, done_at, entity_type, entity_id").eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll"]).order("created_at", { ascending: false }).limit(50),
    ...(["queued", "done", "failed"] as const).map((st) =>
      supabase.from("qoyod_sync_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).in("kind", ["invoice", "invoice_payment", "bill", "bill_payment", "payroll"]).in("status", st === "queued" ? ["queued", "running"] : [st]),
    ),
  ]);
  const rows = jobs ?? [];
  const ids = (t: string) => [...new Set(rows.filter((j) => j.entity_type === t).map((j) => j.entity_id))];
  const [pays, ads, pos, runs] = await Promise.all([
    ids("contract_payment").length ? supabase.from("contract_payments").select("id, seq, label, contract_id").in("id", ids("contract_payment")) : Promise.resolve({ data: [] }),
    ids("addendum").length ? supabase.from("addenda").select("id, number").in("id", ids("addendum")) : Promise.resolve({ data: [] }),
    ids("purchase").length ? supabase.from("purchases").select("id, number, supplier_name").in("id", ids("purchase")) : Promise.resolve({ data: [] }),
    ids("payroll_run").length ? supabase.from("payroll_runs").select("id, month").in("id", ids("payroll_run")) : Promise.resolve({ data: [] }),
  ]);
  const cids = [...new Set((pays.data ?? []).map((p) => p.contract_id))];
  const { data: cons } = cids.length ? await supabase.from("contracts").select("id, number").in("id", cids) : { data: [] };
  const cnum = new Map((cons ?? []).map((c) => [c.id, c.number]));
  const label = new Map<string, string>([
    ...(pays.data ?? []).map((p) => [p.id, `${cnum.get(p.contract_id) ?? ""}/${p.seq} · ${p.label}`] as [string, string]),
    ...(ads.data ?? []).map((a) => [a.id, a.number] as [string, string]),
    ...(pos.data ?? []).map((p) => [p.id, p.supplier_name ? `${p.number} · ${p.supplier_name}` : p.number] as [string, string]),
    ...((runs.data ?? []) as { id: string; month: string }[]).map((r) => [r.id, r.month.slice(0, 7)] as [string, string]),
  ]);
  return {
    settings: s ? { ...s, service_products: (s.service_products ?? {}) as Record<string, number> } : EMPTY,
    jobs: rows.map((j) => ({ id: j.id, kind: j.kind, status: j.status, attempts: j.attempts, last_error: j.last_error, qoyod_id: j.qoyod_id, created_at: j.created_at, done_at: j.done_at, amount: j.amount == null ? null : Number(j.amount), label: label.get(j.entity_id) ?? "—" })),
    counts: { queued: counts[0].count ?? 0, done: counts[1].count ?? 0, failed: counts[2].count ?? 0 },
    canManage: can(session, "settings.manage"),
    canRetry: can(session, "settings.manage") || can(session, "finance.manage"),
  };
}
