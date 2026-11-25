import { ceilTo, sum } from "./math";
import type { EngineResult, Line } from "./types";

/**
 * Price calculation (Appendix A.5):
 *   cost = materials + labour + extras + hatches
 *   cost_with_contingency = cost × (1 + contingency)
 *   price = cost_with_contingency ÷ (1 − margin − commission)   ← margin on selling price
 *   (commission = the success partner's reward, a % of the selling price before VAT; 0 without
 *   a partner. Dividing by (1 − m − k) means that after paying k × price the margin is still m.)
 *   price per m² per work type, rounded UP to the step
 */

export type PriceParams = {
  contingencyPercent: number;
  marginPercent: number;
  roundingStep: number;
  method: "unit" | "lump";
  vatPercent: number; // effective VAT (0 until the company has a VAT number)
  extras?: { label: string; amount: number }[]; // project extras, split by area
  /** the success partner's reward, % of the price before VAT (internal; never on the client's documents) */
  commissionPercent?: number;
};

export type WorkTypePrice = {
  workType: string;
  area: number;
  materials: number;
  labour: number;
  extras: number;
  hatches: number;
  cost: number;
  costWithContingency: number;
  rawPrice: number;
  pricePerM2: number; // rounded up
  total: number; // pricePerM2 × area (unit method)
};

export type PriceSummary = {
  byWorkType: WorkTypePrice[];
  materials: number;
  labour: number;
  extras: number;
  hatches: number;
  cost: number;
  costWithContingency: number;
  subtotal: number; // before VAT
  vat: number;
  total: number;
  /** Achieved margin on selling price after rounding, and the equivalent mark-up on cost. */
  marginPercent: number;
  markupPercent: number;
  targetMarkupPercent: number;
  /** the partner's reward on the subtotal (0 without one) — internal only */
  commissionPercent: number;
  commission: number;
};

/** Cost of a line attributed to a work type (using its allocation if any). */
function share(line: Line, workType: string): number {
  if (line.allocation) return line.cost * (line.allocation[workType] ?? 0);
  return line.workType === workType ? line.cost : 0;
}

export function priceProject(results: EngineResult[], params: PriceParams): PriceSummary {
  const lines = results.flatMap((r) => r.lines);
  const areas: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.areas)) areas[k] = (areas[k] ?? 0) + v;
  const workTypes = Object.keys(areas).filter((k) => areas[k] > 0 || lines.some((l) => share(l, k) > 0));
  const totalArea = sum(workTypes.map((k) => areas[k]));
  const extrasTotal = sum((params.extras ?? []).map((e) => e.amount));

  const c = 1 + params.contingencyPercent / 100;
  const m = params.marginPercent / 100;
  const k = Math.max(0, params.commissionPercent ?? 0) / 100;
  // margin + reward can never leave less than 5 % of the price for cost (no zero / negative division)
  const denominator = Math.max(0.05, 1 - m - k);

  const byWorkType: WorkTypePrice[] = workTypes.map((wt) => {
    const of = (g: Line["group"]) => sum(lines.filter((l) => l.group === g).map((l) => share(l, wt)));
    const projectExtras = totalArea > 0 ? (extrasTotal * areas[wt]) / totalArea : 0;
    const materials = of("material");
    const labour = of("labour");
    const extras = of("extra") + projectExtras;
    const hatches = of("hatch");
    const cost = materials + labour + extras + hatches;
    const costWithContingency = cost * c;
    const rawPrice = costWithContingency / denominator;
    const area = areas[wt];
    const pricePerM2 = area > 0 ? ceilTo(rawPrice / area, params.roundingStep) : 0;
    const total = area > 0 ? pricePerM2 * area : rawPrice;
    return { workType: wt, area, materials, labour, extras, hatches, cost, costWithContingency, rawPrice, pricePerM2, total };
  });

  const t = (k: keyof WorkTypePrice) => sum(byWorkType.map((w) => w[k] as number));
  const cost = t("cost");
  const costWithContingency = t("costWithContingency");
  const subtotal =
    params.method === "unit" ? Math.round(t("total") * 100) / 100 : ceilTo(t("rawPrice"), params.roundingStep);
  const vat = Math.round(subtotal * params.vatPercent) / 100;
  const commission = Math.round(subtotal * k * 100) / 100;
  // achieved margin after the reward (it is a cost of the sale)
  const profit = subtotal - costWithContingency - commission;
  const marginPercent = subtotal > 0 ? (profit / subtotal) * 100 : 0;
  return {
    byWorkType,
    materials: t("materials"),
    labour: t("labour"),
    extras: t("extras"),
    hatches: t("hatches"),
    cost,
    costWithContingency,
    subtotal,
    vat,
    total: Math.round((subtotal + vat) * 100) / 100,
    marginPercent,
    markupPercent: costWithContingency + commission > 0 ? (profit / (costWithContingency + commission)) * 100 : 0,
    targetMarkupPercent: (m / (1 - m)) * 100,
    commissionPercent: k * 100,
    commission,
  };
}
