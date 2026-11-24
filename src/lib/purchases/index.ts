/**
 * Purchases (Phase 6) — pure helpers: invoice draft schema (what the AI
 * returns), totals, review flags and estimated-vs-actual cost status.
 */
import { z } from "zod";
import { projectHref } from "@/lib/finance";

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

/** What is already on (or on its way to) the project, compared with each suggested line. */
export type BoughtRow = { item_id: string | null; product_id: string | null; colour: string | null; unit: string; quantity: number; name?: string | null };

/**
 * G2: what is already bought for the project against each suggested line — by its stock item
 * and colour; a line without a stock item falls back to its catalogue product + unit + colour,
 * only when no other suggested line shares that product (another pack size) and never from a
 * stock item that is another suggested line's own item — so pack sizes and colours never mix.
 * Each bought quantity is counted once. `name` (a new item's name in the form) matches the
 * line's description.
 */
export function markBought(lines: ListLine[], bought: BoughtRow[]): (ListLine & { bought: number; remaining: number })[] {
  const pool = bought.map((b) => ({ ...b, colour: b.colour ?? "", left: b.quantity }));
  const lineItems = new Set(lines.filter((l) => l.item !== "new").map((l) => l.item));
  const key = (p: string, unit: string, colour: string) => `${p}|${unit}|${colour}`;
  const sameProduct = new Map<string, number>();
  for (const l of lines) if (l.product_id) sameProduct.set(key(l.product_id, l.unit, l.colour ?? ""), (sameProduct.get(key(l.product_id, l.unit, l.colour ?? "")) ?? 0) + 1);
  return lines.map((l) => {
    const colour = l.colour ?? "";
    let need = l.quantity;
    let got = 0;
    const take = (match: (b: (typeof pool)[number]) => boolean) => {
      for (const b of pool) {
        if (need <= 0) break;
        if (b.left <= 0 || b.colour !== colour || !match(b)) continue;
        const q = Math.min(b.left, need);
        b.left -= q;
        need -= q;
        got += q;
      }
    };
    if (l.item !== "new") take((b) => b.item_id === l.item);
    else {
      take((b) => !b.item_id && !!b.name && b.name === l.description && b.unit === l.unit);
      if (l.product_id && sameProduct.get(key(l.product_id, l.unit, colour)) === 1) {
        take((b) => b.product_id === l.product_id && b.unit === l.unit && !(b.item_id && lineItems.has(b.item_id)));
      }
    }
    return { ...l, bought: r2(got), remaining: r2(Math.max(0, l.quantity - got)) };
  });
}

/**
 * What a purchase is charged to, as the viewer may see it: general stock, a project they can
 * open (contract with quotes.view, else project with projects.view, else plain text), or a
 * project they can't see at all — never shown as general stock.
 */
export type PurchaseCharge = { kind: "stock" } | { kind: "hidden" } | { kind: "project"; number: string; client: string; href: string | null };
export function purchaseCharge(
  contractId: string | null,
  projects: Map<string, { number: string; client: string }>,
  links: { contracts: boolean; projects: boolean },
): PurchaseCharge {
  if (!contractId) return { kind: "stock" };
  const p = projects.get(contractId);
  if (!p) return { kind: "hidden" };
  return { kind: "project", number: p.number, client: p.client, href: projectHref(p.number, links) };
}

/**
 * What the project holds per stock item and colour: its stock movements (recorded purchases,
 * issues and transfers in, minus returns and transfers out — the same movements as the
 * project's cost) plus the lines of purchases waiting for approval. A movement that didn't come
 * from a purchase line (`colour` null: issue, return, transfer) is shared between the item's colours
 * on this project in proportion to their positive balances (one colour → all of it; colours all
 * used up → equally; no colours → "no colour") — never dropped. Never negative.
 */
export function projectBought(
  moves: { item_id: string; quantity: number; colour: string | null }[],
  pending: { item_id: string | null; colour: string | null; unit: string; quantity: number }[],
  items: { id: string; unit: string; product_id: string | null }[],
): BoughtRow[] {
  const item = new Map(items.map((i) => [i.id, i]));
  // per item: the coloured balances (movements from purchase lines) and the colourless total
  const coloured = new Map<string, Map<string, number>>();
  const plain = new Map<string, number>();
  for (const m of moves) {
    if (m.colour == null) plain.set(m.item_id, (plain.get(m.item_id) ?? 0) + m.quantity);
    else {
      const c = coloured.get(m.item_id) ?? new Map<string, number>();
      c.set(m.colour, (c.get(m.colour) ?? 0) + m.quantity);
      coloured.set(m.item_id, c);
    }
  }
  const net = new Map<string, { item_id: string; colour: string; quantity: number }>();
  const add = (item_id: string, colour: string, quantity: number) => {
    const k = `${item_id}|${colour}`;
    const b = net.get(k) ?? { item_id, colour, quantity: 0 };
    b.quantity += quantity;
    net.set(k, b);
  };
  for (const [id, c] of coloured) for (const [colour, q] of c) add(id, colour, q);
  // a colourless movement (issue, return, transfer) is shared between the item's colours in
  // proportion to their positive balances; all used up → equally; no colours → "no colour"
  for (const [id, q] of plain) {
    const c = coloured.get(id);
    if (!c?.size) {
      add(id, "", q);
      continue;
    }
    const positive = [...c].filter(([, b]) => b > 0);
    const total = positive.reduce((s, [, b]) => s + b, 0);
    const shares = total > 0 ? positive.map(([colour, b]) => [colour, b / total] as const) : [...c.keys()].map((colour) => [colour, 1 / c.size] as const);
    for (const [colour, share] of shares) add(id, colour, q * share);
  }
  const out: BoughtRow[] = [];
  for (const b of net.values()) {
    const q = Math.round(b.quantity * 1000) / 1000;
    if (q <= 0) continue;
    const it = item.get(b.item_id);
    out.push({ item_id: b.item_id, product_id: it?.product_id ?? null, colour: b.colour, unit: it?.unit ?? "", quantity: q });
  }
  for (const p of pending) {
    if (!(p.quantity > 0)) continue;
    out.push({ item_id: p.item_id, product_id: p.item_id ? (item.get(p.item_id)?.product_id ?? null) : null, colour: p.colour ?? "", unit: p.unit, quantity: p.quantity });
  }
  return out;
}

/**
 * «من قائمة مشتريات العرض» pressed again: what is still to add after the rows already in the
 * form (same item, or the same new item's name / product, and colour) — never doubled.
 */
export function stillToAdd<L extends ListLine & { remaining: number }>(
  list: L[],
  rows: { kind: "material" | "expense"; item: string; newName?: string; description: string; product?: string; colour: string; unit: string; quantity: string | number }[],
): (L & { bought: number; remaining: number })[] {
  const held: BoughtRow[] = rows
    .filter((r) => r.kind === "material")
    .map((r) => ({
      item_id: r.item && r.item !== "new" ? r.item : null,
      name: r.item === "new" ? (r.newName || r.description).trim() || null : null,
      product_id: r.item === "new" && r.product ? r.product : null,
      colour: r.colour.trim(),
      unit: r.unit.trim(),
      quantity: Number(r.quantity) || 0,
    }));
  const open = list.filter((l) => l.remaining > 0);
  const marked = markBought(open.map((l) => ({ ...l, quantity: l.remaining })), held);
  return marked.map((m, i) => ({ ...open[i], bought: m.bought, remaining: m.remaining })).filter((l) => l.remaining > 0);
}

/**
 * The stock-item select of a purchase row changed: an item other than the one suggested from
 * the quote list loses the suggested catalogue product (a hidden product_id must never be sent
 * for another item); back to the suggested item restores it.
 */
export function pickStockItem(
  row: { kind: "material" | "expense"; item: string; unit: string; product?: string; suggested?: { item: string; product: string } },
  value: string,
  items: { id: string; unit: string }[],
): { kind: "material" | "expense"; item: string; unit?: string; product: string } {
  if (value === "__expense") return { kind: "expense", item: "", product: "" };
  const it = items.find((x) => x.id === value);
  const product = row.suggested && value === row.suggested.item ? row.suggested.product : "";
  return { kind: "material", item: value, ...(it ? { unit: it.unit } : {}), product };
}

/** Add suggested lines to the form without wiping what is there (AI-read lines); blank rows give way. */
export function mergeRows<T>(existing: T[], incoming: T[], isBlank: (r: T) => boolean): T[] {
  return [...existing.filter((r) => !isBlank(r)), ...incoming];
}

/**
 * G3: purchase lines on an existing stock item that isn't linked to a catalogue product yet,
 * but whose suggested line carries one (from the quote's purchase list) → link it (calibration).
 */
export function itemsToLink(
  lines: { kind: "material" | "expense"; item_id: string | null; product_id?: string | null }[],
  items: { id: string; product_id: string | null }[],
): { id: string; product_id: string }[] {
  const out = new Map<string, string>();
  for (const l of lines) {
    if (l.kind !== "material" || !l.item_id || !l.product_id || out.has(l.item_id)) continue;
    const it = items.find((i) => i.id === l.item_id);
    if (it && !it.product_id) out.set(it.id, l.product_id);
  }
  return [...out].map(([id, product_id]) => ({ id, product_id }));
}

type Num = number | string | null;
export type ProjectCostInput = {
  contracts: { id: string; number: string; client_id: string; status: string }[];
  clients: { id: string; name: string }[];
  moves: { contract_id: string | null; quantity: Num; unit_cost: Num }[];
  purchases: { id: string; contract_id: string | null; status: string; total: Num; subtotal: Num }[];
  subWork: { agreement_id: string; amount: Num }[];
  agreements: { id: string; contract_id: string | null }[];
  petty: { contract_id: string | null; amount: Num }[];
  repairs: { contract_id: string | null; cost: Num }[];
  /** in-house labour per project (null when the viewer can't see it) */
  labour: { contract_id: string | null; labour: Num }[] | null;
  /** expense lines of recorded project purchases */
  expenseLines: { purchase_id: string; amount: Num }[];
  /** estimated material cost per contract (costs.view) */
  estimates: Map<string, number>;
  /** a VAT-registered company reclaims purchase VAT; otherwise VAT is part of cost */
  vatRegistered: boolean;
};

/**
 * Actual vs estimated cost per project from already-loaded rows (pure). The same function serves the
 * costs page (every project) and the project page (rows filtered to one project in the database), so a
 * project's figures can't differ between the two.
 */
export function projectCostRows(d: ProjectCostInput) {
  const n = (v: unknown) => Number(v ?? 0);
  const r = (x: number) => Math.round(x * 100) / 100;
  const sumBy = <T,>(rows: T[], key: (x: T) => string | null | undefined, val: (x: T) => number) => {
    const m = new Map<string, number>();
    for (const x of rows) {
      const k = key(x);
      if (k) m.set(k, (m.get(k) ?? 0) + val(x));
    }
    return m;
  };
  const names = new Map(d.clients.map((c) => [c.id, c.name]));
  const purchaseContract = new Map(d.purchases.map((p) => [p.id, p.contract_id]));
  const agreementContract = new Map(d.agreements.map((g) => [g.id, g.contract_id]));
  const vatFactor = new Map(d.purchases.map((p) => [p.id, d.vatRegistered || !n(p.subtotal) ? 1 : n(p.total) / n(p.subtotal)]));
  const materials = sumBy(d.moves, (m) => m.contract_id, (m) => n(m.quantity) * n(m.unit_cost));
  const expenses = sumBy(d.expenseLines, (l) => purchaseContract.get(l.purchase_id), (l) => n(l.amount) * (vatFactor.get(l.purchase_id) ?? 1));
  const subs = sumBy(d.subWork, (w) => agreementContract.get(w.agreement_id), (w) => n(w.amount));
  const petty = sumBy(d.petty, (e) => e.contract_id, (e) => n(e.amount));
  const pending = sumBy(d.purchases.filter((p) => p.status === "pending_approval"), (p) => p.contract_id, (p) => n(p.total));
  const repairs = sumBy(d.repairs, (m) => m.contract_id, (m) => n(m.cost));
  const labourOf = d.labour ? sumBy(d.labour, (l) => l.contract_id, (l) => n(l.labour)) : null;
  return d.contracts.map((c) => {
    const mat = materials.get(c.id) ?? 0;
    const exp = expenses.get(c.id) ?? 0;
    const pet = petty.get(c.id) ?? 0;
    const sub = subs.get(c.id) ?? 0;
    const maintenance = repairs.get(c.id) ?? 0;
    const labour = labourOf ? labourOf.get(c.id) ?? 0 : null;
    return {
      id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", status: c.status,
      estimated: d.estimates.get(c.id) ?? null, materials: r(mat), expenses: r(exp), subcontractors: r(sub), petty: r(pet),
      materialsActual: r(mat + exp + pet),
      actual: r(mat + exp + pet + sub + maintenance + (labour ?? 0)), pending: r(pending.get(c.id) ?? 0),
      labour: labour == null ? null : r(labour), maintenance: r(maintenance),
    };
  });
}
