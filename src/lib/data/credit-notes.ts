import "server-only";
import { notFound } from "next/navigation";
import type { SessionContext } from "@/lib/auth/session";
import type { CreditNoteDoc } from "@/lib/credit-notes";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

/** One credit note (RLS: finance.view + project access). */
export async function loadCreditNote(session: SessionContext, number: string): Promise<CreditNoteDoc> {
  const supabase = await createClient();
  const { data: c } = await supabase.from("credit_notes").select("*").eq("organization_id", session.organization.id).eq("number", number).maybeSingle();
  if (!c) notFound();
  const [{ data: inv }, { data: con }] = await Promise.all([
    supabase.from("invoices").select("number").eq("id", c.invoice_id).maybeSingle(),
    supabase.from("contracts").select("number").eq("id", c.contract_id).maybeSingle(),
  ]);
  return {
    number: c.number, kind: c.kind, issue_date: c.issue_date, description: c.description, seller: c.seller, buyer: c.buyer,
    subtotal: n(c.subtotal), vat_percent: n(c.vat_percent), vat: n(c.vat), total: n(c.total), created_at: c.created_at,
    invoice: inv?.number ?? "—", contract: con?.number ?? "—",
  };
}

/** A credit note as the invoice document renders it. */
// shared with the client page
export const asInvoiceDoc = (c: CreditNoteDoc) => ({ ...c, due_date: c.issue_date, paid: 0 });
