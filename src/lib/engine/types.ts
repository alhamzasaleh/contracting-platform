/**
 * Pricing engine — shared types.
 *
 * Every computed line is traceable: it carries the formula in words and the
 * inputs used, so the UI can show "how was this calculated".
 */

export type LineGroup = "material" | "labour" | "extra" | "hatch";

export type Purchase =
  | { kind: "packs"; packs: { size: number; count: number; price: number }[]; volume: number; leftover: number }
  | { kind: "bars"; bars: number; stockLength: number; offcuts: number[] }
  | { kind: "units"; count: number; perPack?: number };

export type Line = {
  key: string;
  group: LineGroup;
  label: string;
  productId?: string;
  colour?: string;
  zone?: string;
  /** Technical need (m², L, kg, m, pieces) before buying in packs/bars. */
  need: number;
  needUnit: string;
  /** What to buy. */
  purchase: Purchase;
  /** Quantity bought in purchase units (packs, bars, boxes, m², m…). */
  qty: number;
  unit: string;
  unitPrice: number;
  cost: number;
  formula: string;
  inputs: Record<string, number | string>;
  /**
   * Cost split between work types (e.g. { ceilings: 0.83, partitions: 0.17 }).
   * Missing → whole line belongs to `workType`.
   */
  workType?: string;
  allocation?: Record<string, number>;
};

export type EngineResult = {
  lines: Line[];
  /** Area per work type, for price per m². */
  areas: Record<string, number>;
  status: "measured" | "estimated";
  warnings: string[];
};
