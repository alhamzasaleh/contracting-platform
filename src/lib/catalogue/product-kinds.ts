import type { ProductCategory, ProductFamily, PurchaseUnit } from "@/lib/supabase/database.types";

/**
 * What a product needs depends only on its category — paint needs pack size
 * and coverage, a board needs its area, a bar its length, a box how many
 * pieces it holds. The product form shows only those fields, and the server
 * clears anything that doesn't belong.
 */
export type ProductKind = "coverage" | "board" | "bar" | "contents" | "unit";

export type CategorySpec = {
  kind: ProductKind;
  unit: PurchaseUnit;
  /** For "contents": what the number means (message key suffix). */
  contents?: "pieces" | "metres" | "kg" | "m2" | "crackMetres";
};

const coverage = (unit: PurchaseUnit = "L"): CategorySpec => ({ kind: "coverage", unit });
const bar: CategorySpec = { kind: "bar", unit: "bar" };
const box: CategorySpec = { kind: "contents", unit: "box", contents: "pieces" };

export const CATEGORY_SPEC: Record<ProductCategory, CategorySpec> = {
  putty: coverage("kg"),
  primer: coverage(),
  sealer: coverage("kg"),
  finish_paint: coverage(),
  ceiling_paint: coverage(),
  profile_texture: coverage(),
  spray_paint: coverage(),
  moisture_paint: coverage(),
  decorative: coverage(),
  exterior_primer: coverage(),
  exterior_putty: coverage("kg"),
  exterior_paint: coverage(),
  crack_material: { kind: "contents", unit: "pack", contents: "crackMetres" },
  sundry: { kind: "contents", unit: "pack", contents: "m2" },
  gypsum_board: { kind: "board", unit: "sheet" },
  c_channel: bar,
  omega: bar,
  stud: bar,
  track: bar,
  hanger_rod: bar,
  vertical_hanger: bar,
  angle: bar,
  trough_angle: bar,
  shadow_profile: bar,
  screws: box,
  washers: box,
  anchors: box,
  clips: box,
  tape: { kind: "contents", unit: "roll", contents: "metres" },
  joint_compound: { kind: "contents", unit: "bag", contents: "kg" },
  insulation: { kind: "unit", unit: "m2" },
  hatch: { kind: "unit", unit: "piece" },
  other: { kind: "unit", unit: "piece" },
};

export const CATEGORIES_BY_FAMILY: Record<ProductFamily, ProductCategory[]> = {
  paint: [
    "finish_paint", "ceiling_paint", "putty", "primer", "sealer", "moisture_paint", "decorative",
    "exterior_paint", "exterior_primer", "exterior_putty", "profile_texture", "spray_paint", "crack_material",
  ],
  gypsum: [
    "gypsum_board", "c_channel", "omega", "stud", "track", "hanger_rod", "vertical_hanger", "angle", "trough_angle",
    "shadow_profile", "screws", "washers", "anchors", "clips", "tape", "joint_compound", "insulation", "hatch",
  ],
  other: ["sundry", "other"],
};

type ProductFields = {
  purchase_unit: PurchaseUnit;
  ref_pack_size: number | null;
  coverage_per_pack: number | null;
  surface_factor: number;
  length_m: number | null;
  contents_per_pack: number | null;
  area_m2: number | null;
  colour_specific: boolean;
};

/** Keeps only the fields that belong to the category (and its purchase unit). */
export function normaliseProductFields<T extends ProductFields>(category: ProductCategory, f: T): T {
  const spec = CATEGORY_SPEC[category];
  const isCoverage = spec.kind === "coverage";
  return {
    ...f,
    purchase_unit: spec.unit,
    ref_pack_size: isCoverage ? f.ref_pack_size : null,
    coverage_per_pack: isCoverage ? f.coverage_per_pack : null,
    surface_factor: isCoverage ? f.surface_factor : 1,
    colour_specific: isCoverage ? f.colour_specific : false,
    length_m: spec.kind === "bar" ? f.length_m : null,
    area_m2: spec.kind === "board" ? f.area_m2 : null,
    contents_per_pack: spec.kind === "contents" ? f.contents_per_pack : null,
  };
}

/** The size of the first pack, from the product's own fields. */
export function firstPackSize(category: ProductCategory, f: ProductFields): number | null {
  switch (CATEGORY_SPEC[category].kind) {
    case "coverage":
      return f.ref_pack_size;
    case "bar":
      return f.length_m;
    case "board":
      return f.area_m2;
    case "contents":
      return f.contents_per_pack;
    default:
      return 1;
  }
}

/** Which fields are required for the engine to price this category. */
export function missingFields(category: ProductCategory, f: ProductFields): (keyof ProductFields)[] {
  switch (CATEGORY_SPEC[category].kind) {
    case "coverage":
      return (["ref_pack_size", "coverage_per_pack"] as const).filter((k) => f[k] == null);
    case "bar":
      return f.length_m == null ? ["length_m"] : [];
    case "board":
      return f.area_m2 == null ? ["area_m2"] : [];
    case "contents":
      return f.contents_per_pack == null ? ["contents_per_pack"] : [];
    default:
      return [];
  }
}
