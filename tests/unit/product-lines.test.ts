/** Owner's product model: coverage once per product, brands only add packs & prices. */
import { describe, expect, it } from "vitest";
import { linesToCatalogue, lineMissing, type ProductLine } from "@/lib/catalogue/product-lines";
import { buildEngineConfig, computeExterior, defaultRates, EXTERIOR_RULES, resolveScope } from "@/lib/engine";

const pack = (id: string, size: number, best: number | null) => ({ id, size, label: null, prices: [], best });
const PROFILE: ProductLine = {
  id: "g1", role: "profile", name: "بروفايل خارجي", category: "profile_texture", unit: "L",
  coverage_per_unit: 10 / 30, length_m: null, contents_per_pack: null, area_m2: null, colour_specific: true, waste_percent: null,
  brands: [
    { id: "jotun", brand_id: "b1", brand: "جوتن Jotun", name: "بروفايل خارجي", coverage_per_unit: null, is_active: true, packs: [pack("p1", 30, 30)] },
    { id: "jaz", brand_id: "b2", brand: "الجزيرة", name: "بروفايل خارجي", coverage_per_unit: null, is_active: true, packs: [pack("p2", 18, 20), pack("p3", 4, 6)] },
  ],
};

describe("product lines", () => {
  it("every brand inherits the product's coverage, scaled by its own pack sizes", () => {
    const [jotun, jaz] = linesToCatalogue([PROFILE]);
    expect(jotun).toMatchObject({ role: "profile", brand: "جوتن Jotun", refPackSize: 1, coveragePerPack: 10 / 30, colourSpecific: true });
    expect(jaz.coveragePerPack).toBe(10 / 30);
    expect(jaz.packs).toEqual([{ size: 18, price: 20 }, { size: 4, price: 6 }]);
  });

  it("a brand can override the coverage", () => {
    const line = { ...PROFILE, brands: [{ ...PROFILE.brands[1], coverage_per_unit: 0.5 }] };
    expect(linesToCatalogue([line])[0].coveragePerPack).toBe(0.5);
  });

  it("says what a product still needs", () => {
    expect(lineMissing(PROFILE)).toEqual([]);
    expect(lineMissing({ ...PROFILE, coverage_per_unit: null })).toEqual(["coverage"]);
    expect(lineMissing({ ...PROFILE, brands: [] })).toEqual(["price"]);
  });

  it("prices the owner's Jotun profile (30 L covers 10 m² per coat, 30 SAR) — even if profile's 'used with' excludes profile", () => {
    const cfg = buildEngineConfig({ products: linesToCatalogue([PROFILE]), rates: defaultRates() });
    const broken = EXTERIOR_RULES.map((r) => (r.role === "profile" ? { ...r, variants: ["roller"] } : r));
    const scope = resolveScope(broken, "profile", {}, ["profile"]).scope;
    const r = computeExterior({ area: 660, method: "profile", colours: 1, brand: "جوتن Jotun", scope }, cfg.paintProducts, cfg.exterior);
    const finish = r.lines.find((l) => l.key.startsWith("ext_finish"))!;
    expect(finish.productId).toBe("jotun");
    // 660 × 2 coats ÷ (10/30 m²/L) × 1.05 = 4,158 L → 139 × 30 L × 30 SAR = 4,170
    expect(finish.cost).toBe(4170);
  });
});
