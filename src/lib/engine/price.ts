import { ceilTo, sum } from "./math";
import type { EngineResult, Line } from "./types";

/**
 * Price calculation (Appendix A.5):
 *   cost = materials + labour + extras + hatches
 *   cost_with_contingency = cost × (1 + contingency)
 *   price = cost_with_contingency ÷ (1 − margin)      ← margin on selling price
 *   price per m² per work type, rounded UP to the step
 */

export type PriceParams = {
  contingencyPercent: number;
  marginPercent: number;
  roundingStep: number;
  method: "unit" | "lump";
  vatPercent: number; // effective VAT (0 until the company has a VAT number)
  extras?: { label: string; amount: number }[]; // project extras, split by area
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

  const byWorkType: WorkTypePrice[] = workTypes.map((wt) => {
    const of = (g: Line["group"]) => sum(lines.filter((l) => l.group === g).map((l) => share(l, wt)));
    const projectExtras = totalArea > 0 ? (extrasTotal * areas[wt]) / totalArea : 0;
    const materials = of("material");
    const labour = of("labour");
    const extras = of("extra") + projectExtras;
    const hatches = of("hatch");
    const cost = materials + labour + extras + hatches;
    const costWithContingency = cost * c;
    const rawPrice = costWithContingency / (1 - m);
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
  const marginPercent = subtotal > 0 ? ((subtotal - costWithContingency) / subtotal) * 100 : 0;
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
    markupPercent: costWithContingency > 0 ? ((subtotal - costWithContingency) / costWithContingency) * 100 : 0,
    targetMarkupPercent: (m / (1 - m)) * 100,
  };
}
