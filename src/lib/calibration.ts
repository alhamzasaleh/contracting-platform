import { median } from "@/lib/pricing/history";

/**
 * Appendix A.8 — learning from real projects. For every handed-over project,
 * the material each quote planned (packs × quoted price) is compared with what
 * was actually charged to the project (stock issued − returned, at cost),
 * converted back to "packs at the quoted price" so the two are comparable.
 * When a product is consistently over or under (≥ 3 projects, same direction,
 * median ≥ 10 %), a rate change is SUGGESTED; the owner approves it. Nothing
 * changes automatically.
 */
export type CalibrationInput = {
  contract: string;
  planned: { productId: string; label: string; qty: number; unitPrice: number }[];
  /** actual cost per product charged to this project */
  actual: Record<string, number>;
}[];

export type CalibrationRow = {
  productId: string;
  label: string;
  projects: { contract: string; planned: number; actual: number; variance: number }[];
  /** median of actual ÷ planned − 1 (0.12 = 12 % more used than planned) */
  variance: number | null;
  consistent: boolean;
};

export const MIN_PROJECTS = 3;
export const MIN_VARIANCE = 0.1;

export function calibrate(input: CalibrationInput): CalibrationRow[] {
  const rows = new Map<string, CalibrationRow>();
  for (const p of input) {
    // a product may appear on several lines (colours, zones) — sum per product
    const byProduct = new Map<string, { label: string; qty: number; value: number }>();
    for (const l of p.planned) {
      if (!(l.qty > 0 && l.unitPrice > 0)) continue;
      const x = byProduct.get(l.productId) ?? { label: l.label, qty: 0, value: 0 };
      x.qty += l.qty;
      x.value += l.qty * l.unitPrice;
      byProduct.set(l.productId, x);
    }
    for (const [productId, x] of byProduct) {
      const spent = p.actual[productId];
      if (spent == null) continue; // nothing recorded against this product: no evidence either way
      const avgPrice = x.value / x.qty;
      const actualQty = Math.max(0, spent) / avgPrice;
      const row = rows.get(productId) ?? { productId, label: x.label, projects: [], variance: null, consistent: false };
      row.projects.push({ contract: p.contract, planned: Math.round(x.qty * 100) / 100, actual: Math.round(actualQty * 100) / 100, variance: Math.round((actualQty / x.qty - 1) * 1000) / 1000 });
      rows.set(productId, row);
    }
  }
  return [...rows.values()]
    .map((r) => {
      const v = median(r.projects.map((x) => x.variance));
      const sameSign = r.projects.every((x) => Math.sign(x.variance) === Math.sign(v ?? 0) && x.variance !== 0);
      return { ...r, variance: v == null ? null : Math.round(v * 1000) / 1000, consistent: r.projects.length >= MIN_PROJECTS && v != null && Math.abs(v) >= MIN_VARIANCE && sameSign };
    })
    .sort((a, b) => Number(b.consistent) - Number(a.consistent) || Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0));
}

/** Coverage per litre/kg that would have matched reality: more used → less coverage. */
export function suggestedCoverage(current: number, variance: number): number {
  return Math.round((current / (1 + variance)) * 100) / 100;
}
