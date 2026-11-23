/**
 * Purchases (Phase 6) — pure helpers: invoice draft schema (what the AI
 * returns), totals, review flags and estimated-vs-actual cost status.
 */
import { z } from "zod";

const r2 = (x: number) => Math.round(x * 100) / 100;

/** What the AI extracts from an invoice photo. Every field is a draft for review. */
export const invoiceDraftSchema = z.object({
  supplier_name: z.string().nullable().describe("Seller / supplier name as printed"),
  supplier_vat: z.string().nullable().describe("Seller VAT number (15 digits starting and ending with 3), digits only"),
  invoice_number: z.string().nullable(),
  invoice_date: z.string().nullable().describe("Invoice date as YYYY-MM-DD (Gregorian)"),
  lines: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number(),
        unit: z.string().nullable().describe("Unit as printed, e.g. pcs, box, bag, pail, m"),
        unit_price: z.number().describe("Price per unit before VAT"),
        amount: z.number().describe("Line total before VAT"),
      }),
    )
    .describe("Every item line on the invoice, in order"),
  subtotal: z.number().nullable().describe("Total before VAT"),
  vat: z.number().nullable().describe("VAT amount"),
  total: z.number().nullable().describe("Total including VAT"),
  unclear_fields: z.array(z.string()).describe("Names of fields you could not read confidently, e.g. 'invoice_date', 'lines[2].quantity'"),
});
export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

export type DraftLine = { kind: "material" | "expense"; quantity: number; unit_price: number };

export const lineAmount = (quantity: number, unitPrice: number) => r2(quantity * unitPrice);

/** Subtotal, VAT and total from the lines and the VAT entered on the invoice. */
export function purchaseTotals(lines: DraftLine[], vat: number) {
  const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l.quantity, l.unit_price), 0));
  return { subtotal, vat: r2(vat), total: r2(subtotal + vat) };
}

export type InvoiceFlag = "linesVsSubtotal" | "totalMismatch" | "vatNot15" | "supplierVatInvalid" | "noLines" | "dateMissing";

/** Things to double-check before saving (shown next to the AI draft). */
export function invoiceFlags(d: InvoiceDraft): InvoiceFlag[] {
  const flags: InvoiceFlag[] = [];
  const linesSum = r2(d.lines.reduce((s, l) => s + (l.amount || 0), 0));
  if (!d.lines.length) flags.push("noLines");
  if (d.subtotal != null && d.lines.length && Math.abs(linesSum - d.subtotal) > 0.05) flags.push("linesVsSubtotal");
  if (d.subtotal != null && d.vat != null && d.total != null && Math.abs(d.subtotal + d.vat - d.total) > 0.05) flags.push("totalMismatch");
  if (d.subtotal && d.vat && Math.abs(d.vat - d.subtotal * 0.15) > Math.max(0.5, d.subtotal * 0.002)) flags.push("vatNot15");
  if (d.supplier_vat && !/^3\d{13}3$/.test(d.supplier_vat.replace(/\D/g, ""))) flags.push("supplierVatInvalid");
  if (!d.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(d.invoice_date)) flags.push("dateMissing");
  return flags;
}

/** Estimated vs actual (§3.10): over budget above 100 %, watch from 90 %. */
export function costStatus(estimated: number | null, actual: number): { ratio: number | null; level: "none" | "ok" | "watch" | "over" } {
  if (estimated == null || estimated <= 0) return { ratio: null, level: actual > 0 ? "none" : "none" };
  const ratio = actual / estimated;
  return { ratio, level: ratio > 1 ? "over" : ratio >= 0.9 ? "watch" : "ok" };
}

/** Balance and value per location from signed movements. */
export function stockBalances<M extends { item_id: string; contract_id: string | null; quantity: number; unit_cost: number }>(moves: M[]) {
  const map = new Map<string, { item_id: string; contract_id: string | null; quantity: number; value: number }>();
  for (const m of moves) {
    const key = `${m.item_id}|${m.contract_id ?? ""}`;
    const b = map.get(key) ?? { item_id: m.item_id, contract_id: m.contract_id, quantity: 0, value: 0 };
    b.quantity += m.quantity;
    b.value += m.quantity * m.unit_cost;
    map.set(key, b);
  }
  return [...map.values()].map((b) => ({ ...b, quantity: Math.round(b.quantity * 1000) / 1000, value: r2(b.value) })).filter((b) => Math.abs(b.quantity) > 0.0005);
}

/** A quote purchase-list item (see PurchaseItem in @/lib/quotes). */
type ListItem = { label: string; brand: string | null; colour: string | null; packs: { size: number; count: number }[]; qty: number; unit: string; cost: number; productId?: string | null };
export type ListLine = {
  description: string; colour: string; quantity: number; unit: string; unit_price: number;
  /** existing stock item id, or "new" */
  item: string; product_id: string | null;
  /** general stock (returns to the store) unless it's a colour chosen for this client */
  general: boolean;
};

/**
 * Purchase lines from the accepted quote's purchase list (G2): one line per pack / bar size,
 * the quoted cost as the suggested price (split by volume between sizes), the catalogue product
 * kept so the stock item links to it (G3). The user edits everything before saving.
 */
export function linesFromPurchaseList(list: ListItem[], items: { id: string; name: string; unit: string; product_id: string | null }[]): ListLine[] {
  const out: ListLine[] = [];
  for (const it of list) {
    const base = it.brand ? `${it.label} — ${it.brand}` : it.label;
    const colour = it.colour ?? "";
    const general = !it.colour;
    const product = it.productId ?? null;
    const packs = it.packs.filter((p) => p.count > 0 && p.size > 0);
    const unit = it.unit === "m" ? "bar" : "pack";
    if (!packs.length) {
      const qty = it.qty > 0 ? Math.ceil(it.qty * 100) / 100 : 1;
      const match = items.find((x) => (product && x.product_id === product && x.unit === it.unit) || (x.name === base && x.unit === it.unit));
      out.push({ description: base.slice(0, 200), colour, quantity: qty, unit: it.unit, unit_price: r2(it.cost / qty), item: match?.id ?? "new", product_id: product, general });
      continue;
    }
    const volume = packs.reduce((s, p) => s + p.size * p.count, 0);
    for (const p of packs) {
      const description = `${base} (${p.size})`.slice(0, 200);
      const share = (it.cost * p.size * p.count) / volume;
      const match = items.find((x) => (product && x.product_id === product && x.unit === unit && (packs.length === 1 || x.name === description)) || (x.name === description && x.unit === unit));
      out.push({ description, colour, quantity: p.count, unit, unit_price: r2(share / p.count), item: match?.id ?? "new", product_id: product, general });
    }
  }
  return out;
}
