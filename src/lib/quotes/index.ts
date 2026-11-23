/**
 * Quotes (Phase 3): a priced selection frozen as a version.
 * Pure — the server recomputes the price from the selection and quantities
 * (never trusts numbers sent by the browser) and stores this snapshot.
 */
import type { CatalogueData } from "@/lib/engine";
import { STEPS, type PricingOutcome, type Quantities, type Selection, type ServiceKind } from "@/lib/pricing";

export type ClientView = {
  service: ServiceKind;
  method: "unit" | "lump";
  estimated: boolean;
  workTypes: { workType: string; area: number; pricePerM2: number; total: number }[];
  subtotal: number;
  discount: number;
  /** Discount as a percentage of the subtotal (owner: discounts are given as %). */
  discountPercent?: number;
  net: number;
  vatPercent: number;
  vat: number;
  total: number;
  /** Steps included / not included (keys; labels rendered in the user's language). */
  included: { step: string; brand: string | null; coats: Record<string, number> }[];
  excluded: string[];
  options: Selection["options"];
  features: { troughM: number; shadowM: number; hatches: Record<string, number> };
};

export type PurchaseItem = {
  key: string;
  label: string;
  brand: string | null;
  colour: string | null;
  packs: { size: number; count: number }[];
  qty: number;
  unit: string;
  leftover: number | null;
  cost: number;
};

export type QuoteSnapshot = {
  clientView: ClientView;
  cost: number;
  costWithContingency: number;
  marginPercent: number;
  lines: PricingOutcome["result"]["lines"];
  purchaseList: PurchaseItem[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildSnapshot(
  sel: Selection,
  q: Quantities,
  o: PricingOutcome,
  opts: { discountPercent: number; method: "unit" | "lump"; estimated: boolean; vatPercent: number; catalogue: CatalogueData },
): QuoteSnapshot {
  const p = o.price;
  const discountPercent = Math.min(100, Math.max(0, opts.discountPercent));
  const discount = r2((p.subtotal * discountPercent) / 100);
  const net = r2(p.subtotal - discount);
  const vat = r2((net * opts.vatPercent) / 100);
  const visible = STEPS[sel.kind].filter((s) => !s.when || s.when(sel.options));
  const included: ClientView["included"] = [];
  const excluded: string[] = [];
  for (const s of visible) {
    const c = sel.steps[s.key];
    const on = s.toggle ? c.on : s.coats ? s.coats.some((k) => (c.coats[k.key] ?? 0) > 0) : true;
    if (on) included.push({ step: s.key, brand: s.brandOnly || s.roles.length ? c.brand : null, coats: c.coats });
    else excluded.push(s.key);
  }
  const brandOf = new Map(opts.catalogue.products.map((x) => [x.id, x.brand]));
  const purchaseList: PurchaseItem[] = o.result.lines
    // things to buy: priced materials, except per-m² allowances (consumables, protection)
    .filter((l) => l.group === "material" && l.cost > 0 && !(l.purchase.kind === "units" && l.unit === "m2"))
    .map((l) => ({
      key: l.key,
      label: l.label,
      brand: l.productId ? (brandOf.get(l.productId) ?? null) : null,
      colour: l.colour ?? null,
      packs: l.purchase.kind === "packs" ? l.purchase.packs.map((k) => ({ size: k.size, count: k.count })) : l.purchase.kind === "bars" ? [{ size: l.purchase.stockLength, count: l.purchase.bars }] : [],
      qty: l.qty,
      unit: l.unit,
      leftover: l.purchase.kind === "packs" ? r2(l.purchase.leftover) : null,
      cost: r2(l.cost),
    }));
  return {
    clientView: {
      service: sel.kind,
      method: opts.method,
      estimated: opts.estimated,
      workTypes: p.byWorkType.map((w) => ({ workType: w.workType, area: r2(w.area), pricePerM2: w.pricePerM2, total: r2(w.total) })),
      subtotal: r2(p.subtotal),
      discount,
      discountPercent,
      net,
      vatPercent: opts.vatPercent,
      vat,
      total: r2(net + vat),
      included,
      excluded,
      options: sel.options,
      // troughs, shadow gaps and hatches are gypsum features only
      features: sel.kind === "gypsum" ? { troughM: q.troughM, shadowM: q.shadowM, hatches: q.hatches } : { troughM: 0, shadowM: 0, hatches: {} },
    },
    cost: r2(p.cost),
    costWithContingency: r2(p.costWithContingency),
    // margin after any discount, on the selling price
    marginPercent: net > 0 ? r2(((net - p.costWithContingency) / net) * 100) : 0,
    lines: o.result.lines,
    purchaseList,
  };
}

export type ReadinessIssue = "unpriced_items" | "no_area" | "below_min_margin" | "discount";

/** "Ready to issue" or what needs attention (Appendix A.5 readiness check). */
export function readiness(o: PricingOutcome, snap: QuoteSnapshot, minMargin: number, gaps: string[]): { blocking: ReadinessIssue[]; approvals: ("quote_margin" | "quote_discount")[] } {
  const blocking: ReadinessIssue[] = [];
  if (o.problems.length) blocking.push("unpriced_items");
  if (gaps.length || snap.clientView.workTypes.every((w) => w.area <= 0)) blocking.push("no_area");
  const approvals: ("quote_margin" | "quote_discount")[] = [];
  if (snap.marginPercent < minMargin) approvals.push("quote_margin");
  if (snap.clientView.discount > 0) approvals.push("quote_discount");
  return { blocking, approvals };
}
