import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@/lib/supabase/database.types";

/**
 * Appendix A.1: a product's technical datasheet (PDF or photo) → a DRAFT the owner
 * reviews before creating the product. Coverage is kept as printed (pack size +
 * area per coat) so the owner can check it against the datasheet.
 */
export const datasheetSchema = z.object({
  product_name: z.string().nullable().describe("Product name as printed (Arabic or English)"),
  brand: z.string().nullable().describe("Manufacturer / brand, e.g. Jotun, Al-Jazeera, National, Knauf"),
  category: z.enum(PRODUCT_CATEGORIES).nullable().describe("Best matching category; null if unsure"),
  unit: z.enum(["L", "kg"]).nullable().describe("Unit the coverage is expressed in (litre or kilogram)"),
  coverage_m2_per_unit: z.number().nullable().describe("Theoretical spreading rate per coat in m² per litre (or per kg). If a range is printed, use the LOWER practical value."),
  coverage_text: z.string().nullable().describe("The coverage exactly as printed, e.g. «10–12 m²/L per coat»"),
  pack_sizes: z.array(z.number()).describe("Pack sizes in the same unit, e.g. [18, 4, 1]"),
  recommended_coats: z.number().nullable(),
  drying_time: z.string().nullable().describe("Touch dry / recoat time as printed"),
  use: z.enum(["interior", "exterior", "both"]).nullable(),
  notes: z.array(z.string()).describe("Short Arabic notes worth knowing for pricing (e.g. surface preparation, thinning)"),
  unclear: z.array(z.string()).describe("Short Arabic notes about anything not found or unclear"),
});
export type DatasheetDraft = z.infer<typeof datasheetSchema>;

/** Sanity limits: coverage per litre/kg per coat is rarely below 0.2 or above 30 m². */
export function cleanDatasheet(d: DatasheetDraft): DatasheetDraft & { flags: string[] } {
  const flags: string[] = [];
  let cov = d.coverage_m2_per_unit;
  if (cov != null && !(cov > 0.2 && cov <= 30)) {
    flags.push("coverage");
    cov = null;
  }
  const packs = [...new Set(d.pack_sizes.filter((s) => s > 0 && s <= 1000).map((s) => Math.round(s * 100) / 100))].sort((a, b) => b - a).slice(0, 6);
  const coats = d.recommended_coats != null && d.recommended_coats >= 1 && d.recommended_coats <= 6 ? Math.round(d.recommended_coats) : null;
  return { ...d, coverage_m2_per_unit: cov == null ? null : Math.round(cov * 100) / 100, pack_sizes: packs, recommended_coats: coats, notes: d.notes.slice(0, 8), unclear: d.unclear.slice(0, 8), flags };
}

export type DatasheetResult = ReturnType<typeof cleanDatasheet>;
