import type { InvoiceParty } from "@/lib/supabase/database.types";

/** A credit note (إشعار دائن, CN-): made by the database when a signed measurement reduces what was invoiced. */
export type CreditNoteDoc = {
  number: string; kind: "tax" | "simple"; issue_date: string; description: string; seller: InvoiceParty; buyer: InvoiceParty;
  subtotal: number; vat_percent: number; vat: number; total: number; created_at?: string;
  /** the invoice it reduces */
  invoice: string;
  contract: string;
};

export const CREDIT_NOTE_RE = /^CN-\d{4}-\d{3,6}$/;
