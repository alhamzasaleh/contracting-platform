import type { InvoiceParty } from "@/lib/supabase/database.types";

/** An invoice as shown on screens and documents (amounts as numbers; paid from the payment it bills). */
export type InvoiceDoc = {
  number: string; kind: "tax" | "simple"; issue_date: string; due_date: string; description: string;
  seller: InvoiceParty; buyer: InvoiceParty; subtotal: number; vat_percent: number; vat: number; total: number; paid: number;
  contract: string;
  /** issue time (for the ZATCA QR) */
  created_at?: string;
  /** credit notes issued against it (a signed measurement took part of it off) */
  credited?: number;
};
export type InvoiceStatus = "paid" | "partial" | "overdue" | "due";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Paid on an invoice: what was received, or its whole amount once the payment is marked paid
 * (rows marked paid before amounts were recorded have no amount). */
export function invoicePaid(total: number, p: { amount: number; full: boolean } | undefined, credited = 0): number {
  if (!p) return 0;
  // paid in full = the invoice less what credit notes took off it
  return p.full ? Math.max(r2(total - credited), p.amount) : p.amount;
}

export function invoiceStatus(i: { total: number; paid: number; due_date: string; credited?: number }, today: string): InvoiceStatus {
  if (i.paid + (i.credited ?? 0) >= i.total - 0.005) return "paid";
  if (i.due_date < today) return "overdue";
  return i.paid > 0.005 ? "partial" : "due";
}

export const invoiceRemaining = (i: { total: number; paid: number; credited?: number }) => Math.max(0, r2(i.total - i.paid - (i.credited ?? 0)));
