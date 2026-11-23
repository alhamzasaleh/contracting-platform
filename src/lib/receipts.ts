/** Receipt vouchers (سند قبض) — shared shape and running totals for the document. */
export type ReceiptItem = { number: string; label: string; amount: number; paid_on: string; method: "transfer" | "cash" | "cheque" | "card" | null; reference: string | null; created_at: string };

export type ReceiptDoc = {
  org: { name: string; legal_name: string | null; cr_number: string | null; vat_number: string | null; phone: string | null; city: string | null; address: string | null; signatory_name: string | null; signatory_title: string | null; logoUrl?: string | null };
  client: { name: string; phone: string | null };
  contract: { number: string; value: number };
  receipt: ReceiptItem;
  /** Received up to and including this voucher; what remains of the contract (with accepted addenda). */
  receivedToDate: number;
  remaining: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function receiptTotals(all: ReceiptItem[], number: string, contractValue: number) {
  const sorted = [...all].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.number.localeCompare(b.number));
  const idx = sorted.findIndex((r) => r.number === number);
  if (idx < 0) return null;
  const receivedToDate = r2(sorted.slice(0, idx + 1).reduce((s, r) => s + r.amount, 0));
  return { receipt: sorted[idx], receivedToDate, remaining: Math.max(0, r2(contractValue - receivedToDate)) };
}
