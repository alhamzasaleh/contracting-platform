import "server-only";
import { notFound } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
import { receiptTotals, type ReceiptDoc, type ReceiptItem } from "@/lib/receipts";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

/** One voucher with its contract's running totals (RLS: finance.view or quotes.view). */
export async function loadReceipt(session: SessionContext, number: string): Promise<ReceiptDoc> {
  const supabase = await createClient();
  const { data: rec } = await supabase.from("client_receipts").select("contract_id").eq("organization_id", session.organization.id).eq("number", number).maybeSingle();
  if (!rec) notFound();
  const [{ data: c }, { data: all }, { data: ads }] = await Promise.all([
    supabase.from("contracts").select("number, total, client_id").eq("id", rec.contract_id).single(),
    supabase.from("client_receipts").select("number, label, amount, paid_on, method, reference, created_at").eq("contract_id", rec.contract_id),
    supabase.from("addenda").select("total").eq("contract_id", rec.contract_id).eq("status", "accepted"),
  ]);
  if (!c) notFound();
  const { data: client } = await supabase.from("clients").select("name, phone").eq("id", c.client_id).maybeSingle();
  const value = n(c.total) + (ads ?? []).reduce((s, a) => s + n(a.total), 0);
  const items: ReceiptItem[] = (all ?? []).map((r) => ({ ...r, amount: n(r.amount) }));
  const totals = receiptTotals(items, number, value);
  if (!totals) notFound();
  const o = session.organization;
  return {
    org: { name: o.name, legal_name: o.legal_name, cr_number: o.cr_number, vat_number: o.vat_number, phone: o.phone, city: o.city, address: o.address, signatory_name: o.signatory_name, signatory_title: o.signatory_title },
    client: { name: client?.name ?? "—", phone: client?.phone ?? null },
    contract: { number: c.number, value },
    ...totals,
  };
}
