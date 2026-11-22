import type { CatalogueProduct } from "@/lib/engine";
import type { ProductCategory, PurchaseUnit } from "@/lib/supabase/database.types";
import { CATEGORY_SPEC } from "./product-kinds";

/**
 * The owner's product model:
 *   PRODUCT (e.g. "بروفايل خارجي") — type + coverage per litre/kg per coat
 *     └─ BRAND (Jotun, Al-Jazeera…) — pack sizes and their prices
 * Coverage is entered once on the product; each pack's coverage follows its
 * size. A brand may override the coverage only if it really differs.
 */

export type LinePack = {
  id: string;
  size: number;
  label: string | null;
  prices: { supplier_id: string | null; supplier_name: string | null; unit_price: number; since: string }[];
  best: number | null;
};

export type LineBrand = {
  /** products.id */
  id: string;
  brand_id: string | null;
  brand: string | null;
  name: string;
  /** Brand-specific coverage per unit (null = the product's). */
  coverage_per_unit: number | null;
  is_active: boolean;
  packs: LinePack[];
};

export type ProductLine = {
  /** equivalence_groups.id (null = brand rows not linked to any product yet). */
  id: string | null;
  role: string | null;
  name: string;
  category: ProductCategory;
  unit: PurchaseUnit;
  coverage_per_unit: number | null;
  length_m: number | null;
  contents_per_pack: number | null;
  area_m2: number | null;
  colour_specific: boolean;
  waste_percent: number | null;
  brands: LineBrand[];
};

/** Coverage per litre/kg for one coat, for a brand of a product. */
export const brandCoverage = (line: ProductLine, b: LineBrand) => b.coverage_per_unit ?? line.coverage_per_unit;

/** What the line still needs before the engine can price it. */
export function lineMissing(line: ProductLine): ("coverage" | "length" | "contents" | "area" | "price")[] {
  const kind = CATEGORY_SPEC[line.category].kind;
  const out: ("coverage" | "length" | "contents" | "area" | "price")[] = [];
  if (kind === "coverage" && !line.coverage_per_unit && !line.brands.some((b) => b.coverage_per_unit)) out.push("coverage");
  if (kind === "bar" && !line.length_m) out.push("length");
  if (kind === "contents" && !line.contents_per_pack) out.push("contents");
  if (kind === "board" && !line.area_m2) out.push("area");
  if (!line.brands.some((b) => b.is_active && b.packs.some((k) => k.best != null))) out.push("price");
  return out;
}

/** Engine input: one priced product per active brand of every linked line. */
export function linesToCatalogue(lines: ProductLine[]): CatalogueProduct[] {
  const out: CatalogueProduct[] = [];
  for (const line of lines) {
    for (const b of line.brands) {
      if (!b.is_active) continue;
      const cov = brandCoverage(line, b);
      out.push({
        id: b.id,
        role: line.role,
        brand: b.brand,
        name: line.name,
        category: line.category,
        unit: line.unit,
        // coverage per unit → a 1-unit reference pack; real packs scale from it
        refPackSize: cov ? 1 : null,
        coveragePerPack: cov,
        surfaceFactor: 1,
        lengthM: line.length_m,
        contentsPerPack: line.contents_per_pack,
        areaM2: line.area_m2,
        colourSpecific: line.colour_specific,
        wastePercent: line.waste_percent,
        packs: b.packs.map((k) => ({ size: k.size, price: k.best })),
      });
    }
  }
  return out;
}
