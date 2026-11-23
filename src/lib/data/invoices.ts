import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import { invoicePaid, type InvoiceDoc } from "@/lib/invoices";
import { createClient } from "@/lib/supabase/server";

export type InvoiceListItem = InvoiceDoc & { id: string; client: string; qoyod: "none" | "queued" | "done" | "failed"; qoyodJob: string | null };
export type InvoicesPageData = { invoices: InvoiceListItem[]; qoyodEnabled: boolean; vatRegistered: boolean; canFinance: boolean };

const n = (v: unknown) => Number(v ?? 0);

async function build(session: SessionContext, filter?: { number: string }): Promise<{ items: InvoiceListItem[]; qoyodEnabled: boolean }> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  let q = supabase.from("invoices").select("*").eq("organization_id", orgId).order("issue_date", { ascending: false }).order("number", { ascending: false }).limit(500);
  if (filter) q = q.eq("number", filter.number);
  const [{ data: rows }, { data: qs }] = await Promise.all([q, supabase.from("qoyod_settings").select("enabled").eq("organization_id", orgId).maybeSingle()]);
  const list = rows ?? [];
  const payIds = list.flatMap((i) => (i.payment_id ? [i.payment_id] : []));
  const adIds = list.flatMap((i) => (i.addendum_id ? [i.addendum_id] : []));
  const cIds = [...new Set(list.map((i) => i.contract_id))];
  const entityIds = [...payIds, ...adIds];
  const [{ data: pays }, { data: ads }, { data: cons }, { data: jobs }] = await Promise.all([
    payIds.length ? supabase.from("contract_payments").select("id, paid_amount, status").in("id", payIds) : Promise.resolve({ data: [] }),
    adIds.length ? supabase.from("addenda").select("id, paid_amount, payment_status").in("id", adIds) : Promise.resolve({ data: [] }),
    cIds.length ? supabase.from("contracts").select("id, number").in("id", cIds) : Promise.resolve({ data: [] }),
    entityIds.length && can(session, "finance.view") ? supabase.from("qoyod_sync_jobs").select("id, entity_id, status").eq("kind", "invoice").in("entity_id", entityIds) : Promise.resolve({ data: [] }),
  ]);
  // marked paid = paid in full (also rows from before amounts were recorded: paid_amount null)
  const paidIn = new Map<string, { amount: number; full: boolean }>([
    ...(pays ?? []).map((p) => [p.id, { amount: n(p.paid_amount), full: p.status === "paid" }] as const),
    ...(ads ?? []).map((a) => [a.id, { amount: n(a.paid_amount), full: a.payment_status === "paid" }] as const),
  ]);
  const cnum = new Map((cons ?? []).map((c) => [c.id, c.number]));
  const job = new Map((jobs ?? []).map((j) => [j.entity_id, j]));
  return {
    qoyodEnabled: !!qs?.enabled,
    items: list.map((i) => {
      const ent = (i.payment_id ?? i.addendum_id)!;
      const j = job.get(ent);
      return {
        id: i.id, number: i.number, kind: i.kind, issue_date: i.issue_date, due_date: i.due_date, description: i.description,
        seller: i.seller, buyer: i.buyer, subtotal: n(i.subtotal), vat_percent: n(i.vat_percent), vat: n(i.vat), total: n(i.total),
        paid: invoicePaid(n(i.total), paidIn.get(ent)), created_at: i.created_at, contract: cnum.get(i.contract_id) ?? "—", client: i.buyer?.name ?? "—",
        qoyod: !j ? "none" : j.status === "done" ? "done" : j.status === "failed" ? "failed" : "queued", qoyodJob: j?.status === "done" ? j.id : null,
      };
    }),
  };
}

export async function loadInvoices(session: SessionContext): Promise<InvoicesPageData> {
  const { items, qoyodEnabled } = await build(session);
  return { invoices: items, qoyodEnabled, vatRegistered: !!session.organization.vat_number, canFinance: can(session, "finance.view") };
}

export async function loadInvoice(session: SessionContext, number: string): Promise<InvoiceListItem & { qoyodEnabled: boolean }> {
  const { items, qoyodEnabled } = await build(session, { number });
  if (!items[0]) notFound();
  return { ...items[0], qoyodEnabled };
}
