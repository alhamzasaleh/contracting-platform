/**
 * Bill of quantities (owner, Nov 2026): what the purchaser buys for a quote / project — every
 * material by product, pack size and colour, with the packs to buy, the quantity actually needed
 * and the expected leftover. Pure: built from the quote version's frozen purchase list and the
 * frozen engine lines (never re-priced in the browser). Prices appear only when asked for
 * (`prices: true`, costs.view on the server) — otherwise no row carries any price field.
 */
import { GENERIC_BRAND } from "@/lib/engine/catalogue";
import { GENERIC_DEFAULT_BRAND } from "@/lib/engine/defaults";
import type { Line, Purchase } from "@/lib/engine/types";
import { linesFromPurchaseList, markBought, type BoughtRow } from "@/lib/purchases";
import type { PurchaseItem } from "./index";

/** A frozen purchase-list item; `cost` only reaches here with costs.view. */
export type QtyItem = Omit<PurchaseItem, "cost"> & { cost?: number };
/**
 * What the table needs from the frozen engine line with the same key — quantities only, no
 * prices (the database's quote_version_quantities() returns exactly this for quotes.view).
 */
export type QtyNeed = {
  key: string; need: number | null; needUnit: string | null; perPack: number | null;
  /** priced path only (costs.view): each pack / bar / box size's own price at pricing time */
  packPrices?: { size: number | null; price: number }[];
};
export type QtySource = { items: QtyItem[]; needs: QtyNeed[] };

/** One thing to buy: `count` × (`size` `sizeUnit`) in purchase units (pack, bar, box, board…). */
export type BuyPart = { count: number; size: number | null; sizeUnit: string | null; unit: string };

export type MaterialRow = {
  key: string;
  material: string;
  brand: string | null;
  colour: string | null;
  size: number | null;
  sizeUnit: string | null;
  /** quantity actually needed (incl. waste) covered by this pack size */
  need: number | null;
  needUnit: string | null;
  /** packs / bars / boxes to buy */
  count: number;
  unit: string;
  /** expected leftover after use, in the size's unit (null when unknown) */
  leftover: number | null;
  unitPrice?: number;
  cost?: number;
  /** priced table: no price at pricing time — the total is incomplete */
  unpriced?: boolean;
  /** project only: already bought / still to buy (in `unit`) */
  bought?: number;
  remaining?: number;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** What an engine line says to buy, split by pack size (pricing screen and quote page). */
export function buyParts(purchase: Purchase, needUnit: string | null, unit: string, qty: number): BuyPart[] {
  if (purchase.kind === "packs") return purchase.packs.filter((k) => k.count > 0).map((k) => ({ count: k.count, size: k.size, sizeUnit: needUnit, unit: "pack" }));
  if (purchase.kind === "bars") return [{ count: purchase.bars, size: purchase.stockLength, sizeUnit: "m", unit: "bar" }];
  return [{ count: qty, size: purchase.perPack ?? null, sizeUnit: purchase.perPack ? needUnit : null, unit }];
}

/**
 * The quantities of the frozen material (and hatch) lines — same rule as the SQL
 * quote_version_quantities(). `prices` (costs.view only) adds each size's own price.
 */
export function needsFromLines(lines: Line[], opts: { prices?: boolean } = {}): QtyNeed[] {
  return lines
    .filter((l) => l.group === "material" || l.group === "hatch")
    .map((l) => {
      const p = l.purchase;
      const perPack = p.kind === "units" ? (p.perPack ?? null) : null;
      const base: QtyNeed = { key: l.key, need: l.need, needUnit: l.needUnit || null, perPack };
      if (!opts.prices) return base;
      const packPrices = p.kind === "packs" ? p.packs.map((k) => ({ size: k.size, price: k.price })) : [{ size: p.kind === "bars" ? p.stockLength : perPack, price: l.unitPrice }];
      return { ...base, packPrices };
    });
}

/** A purchase-list item's parts, in the same order as linesFromPurchaseList() makes its lines. */
export function itemParts(it: QtyItem, n: QtyNeed | undefined): BuyPart[] {
  const packs = it.packs.filter((p) => p.count > 0 && p.size > 0);
  if (packs.length) {
    const bar = it.unit === "bar";
    return packs.map((p) => ({ count: p.count, size: p.size, sizeUnit: bar ? "m" : (n?.needUnit ?? null), unit: bar ? "bar" : "pack" }));
  }
  const perPack = n?.perPack ?? null;
  return [{ count: it.qty, size: perPack, sizeUnit: perPack ? (n?.needUnit ?? null) : null, unit: it.unit }];
}

/** The engine's fallback A.6 products are branded "Generic" — no brand for the reader. */
const NO_BRAND = new Set([GENERIC_BRAND, GENERIC_DEFAULT_BRAND]);
const brandOf = (b: string | null) => (b && !NO_BRAND.has(b) ? b : null);

/** "بروفايل / تكسير — جوتن (لون 1)" → "بروفايل / تكسير" (brand and colour have their own columns). */
function materialName(it: QtyItem): string {
  let s = it.label.trim();
  if (it.colour && s.endsWith(` (${it.colour})`)) s = s.slice(0, -` (${it.colour})`.length);
  for (const b of [it.brand, ...NO_BRAND]) if (b && s.endsWith(` — ${b}`)) s = s.slice(0, -` — ${b}`.length);
  return s;
}

export function materialRows(src: QtySource, opts: { prices: boolean; bought?: { stock: { id: string; name: string; unit: string; product_id: string | null }[]; rows: BoughtRow[] } }): MaterialRow[] {
  const needOf = new Map(src.needs.map((n) => [n.key, n]));
  // bought per part: the purchase form's own lines and matching (one line per item and pack size)
  let marked: { bought: number }[] | null = null;
  if (opts.bought) {
    const list = src.items.map((it) => ({ ...it, cost: 0 }));
    marked = markBought(linesFromPurchaseList(list, opts.bought.stock), opts.bought.rows);
  }
  const rows = new Map<string, MaterialRow>();
  let li = 0;
  for (const it of src.items) {
    const n = needOf.get(it.key);
    const parts = itemParts(it, n);
    const volume = parts.reduce((s, p) => s + (p.size ?? 0) * p.count, 0);
    // the need, filled from the largest pack down; a quote without the line's need falls back to volume − leftover
    let left = n?.need ?? (it.leftover != null && volume > 0 ? volume - it.leftover : null);
    const material = materialName(it);
    for (const p of parts) {
      const got = marked ? (marked[li]?.bought ?? 0) : null;
      li++;
      let need: number | null = null;
      let leftover: number | null = null;
      if (p.size != null && left != null) {
        const vol = p.size * p.count;
        need = Math.max(0, Math.min(vol, left));
        leftover = vol - need;
        left -= need;
      } else if (p.size == null && n?.need != null) need = n.need;
      const key = [it.productId ?? `label:${material}`, it.brand ?? "", it.colour ?? "", p.size ?? "", p.sizeUnit ?? "", p.unit].join("|");
      const row = rows.get(key) ?? {
        key, material, brand: brandOf(it.brand), colour: it.colour, size: p.size, sizeUnit: p.sizeUnit,
        need: null, needUnit: p.size != null ? p.sizeUnit : (n?.needUnit ?? null), count: 0, unit: p.unit, leftover: null,
        ...(opts.prices ? { cost: 0 } : {}),
        ...(marked ? { bought: 0 } : {}),
      };
      row.count += p.count;
      if (need != null) row.need = r3((row.need ?? 0) + need);
      if (leftover != null) row.leftover = r3((row.leftover ?? 0) + leftover);
      if (opts.prices) {
        // the size's own price at pricing time; older versions without it: the item's cost split by volume
        const own = n?.packPrices?.find((k) => k.size === p.size);
        const share = volume > 0 && p.size != null ? (p.size * p.count) / volume : 1 / parts.length;
        row.cost = r2((row.cost ?? 0) + (own ? own.price * p.count : (it.cost ?? 0) * share));
      }
      if (marked && got != null) row.bought = r3((row.bought ?? 0) + got);
      rows.set(key, row);
    }
  }
  return [...rows.values()].map((r) => ({
    ...r,
    ...(opts.prices ? { unitPrice: r.count > 0 ? r2((r.cost ?? 0) / r.count) : 0, unpriced: !((r.cost ?? 0) > 0) } : {}),
    ...(marked ? { remaining: r3(Math.max(0, r.count - (r.bought ?? 0))) } : {}),
  }));
}
