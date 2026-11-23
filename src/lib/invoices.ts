import type { InvoiceParty } from "@/lib/supabase/database.types";

/** An invoice as shown on screens and documents (amounts as numbers; paid from the payment it bills). */
export type InvoiceDoc = {
  number: string; kind: "tax" | "simple"; issue_date: string; due_date: string; description: string;
  seller: InvoiceParty; buyer: InvoiceParty; subtotal: number; vat_percent: number; vat: number; total: number; paid: number;
  contract: string;
};
export type InvoiceStatus = "paid" | "partial" | "overdue" | "due";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceStatus(i: { total: number; paid: number; due_date: string }, today: string): InvoiceStatus {
  if (i.paid >= i.total - 0.005) return "paid";
  if (i.due_date < today) return "overdue";
  return i.paid > 0.005 ? "partial" : "due";
}

export const invoiceRemaining = (i: { total: number; paid: number }) => Math.max(0, r2(i.total - i.paid));
