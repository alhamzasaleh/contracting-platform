/**
 * The catalogue adapter: rows from the database → engine config.
 * Fed with the seeded Appendix A.6 catalogue it must reproduce the golden results.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEngineConfig,
  computeGypsum,
  defaultRates,
  EXTERIOR_PARAMS,
  GYPSUM_CATALOGUE,
  GYPSUM_PARAMS,
  INTERIOR_PARAMS,
  priceProject,
  type CatalogueProduct,
} from "@/lib/engine";

const MIGRATION = readFileSync("supabase/migrations/20261124000001_pricing_engine.sql", "utf8");

/** Products exactly as seed_pricing_engine() creates them (parsed from the migration). */
function seededProducts(): CatalogueProduct[] {
  const rows = [...MIGRATION.matchAll(/^\s*\('([a-z0-9_]+)', '[^']*', '([^']*)', '[a-z_]+', '([A-Za-z0-9]+)', ([^,]+), ([^,]+), ([^,]+), ([^,]+), ([^,]+), (true|false), '[a-z]+', '[^']*', ([0-9.]+)(?:::numeric)?, '(\{[^']*\})'\)/gm)];
  const n = (s: string) => {
    const v = s.replace("::numeric", "").trim();
    return v === "null" ? null : Number(v);
  };
  return rows.map(([, role, name, unit, refPack, coverage, length, contents, area, colour, price, specs]) => {
    const size = n(refPack) ?? n(contents) ?? n(length) ?? n(area) ?? 1;
    return {
      id: role,
      role,
      brand: null,
      name,
      unit,
      refPackSize: n(refPack),
      coveragePerPack: n(coverage),
      surfaceFactor: 1,
      lengthM: n(length),
      contentsPerPack: n(contents),
      areaM2: n(area),
      colourSpecific: colour === "true",
      wastePercent: (JSON.parse(specs) as { wastePercent?: number }).wastePercent ?? null,
      packs: [{ size, price: Number(price) > 0 ? Number(price) : null }],
    };
  });
}

function seededRates(): Record<string, number> {
  return Object.fromEntries([...MIGRATION.matchAll(/\(p_org, '[a-z]+', \d+, '([a-zA-Z0-9_.]+)', ([0-9.]+),/g)].map(([, k, v]) => [k, Number(v)]));
}

describe("seed ↔ engine defaults stay in sync", () => {
  it("parses every seeded product and rate", () => {
    expect(seededProducts()).toHaveLength(40);
    expect(Object.keys(seededRates()).length).toBeGreaterThan(50);
  });

  it("seeds exactly the rates the engine reads, with the A.6 values", () => {
    expect(seededRates()).toEqual(defaultRates());
  });
});

describe("buildEngineConfig", () => {
  const cfg = buildEngineConfig({ products: seededProducts(), rates: seededRates() });

  it("reproduces the A.6 parameters from the seeded catalogue", () => {
    expect(cfg.gypsum.params).toEqual(GYPSUM_PARAMS);
    expect(cfg.interior).toEqual(INTERIOR_PARAMS);
    expect(cfg.exterior).toEqual(EXTERIOR_PARAMS);
    const { boards, cChannel, washers, tape, compound, hatches, labour, insulationPerM2 } = cfg.gypsum.catalogue;
    expect(boards.normal).toMatchObject({ area: 2.88, price: 22 });
    expect(cChannel).toMatchObject({ length: 3, price: 11 });
    expect(washers).toMatchObject({ count: 100, price: 25 });
    expect(tape).toMatchObject({ length: 90, price: 12 });
    expect(compound).toMatchObject({ kg: 20, price: 28 });
    expect(hatches).toEqual(GYPSUM_CATALOGUE.hatches);
    expect(labour).toEqual(GYPSUM_CATALOGUE.labour);
    expect(insulationPerM2).toBe(18);
  });

  it("reports only the profile finish as missing a price (no A.6 value)", () => {
    expect(cfg.warnings).toEqual([{ kind: "missing_price", role: "profile", product: "بروفايل خارجي" }]);
  });

  it("gives the same golden gypsum result as the built-in defaults", () => {
    const input = {
      rooms: [
        { id: "a", name: "a", L: 10, W: 8, boardType: "normal" as const },
        { id: "b", name: "b", L: 10, W: 10, boardType: "normal" as const },
        ...[1, 2, 3, 4].map((i) => ({ id: `bed${i}`, name: "bed", L: 5, W: 5, boardType: "normal" as const })),
        { id: "c", name: "c", L: 13, W: 5, boardType: "normal" as const },
        { id: "k", name: "k", L: 5, W: 5, boardType: "fire" as const, zone: "kitchen" },
        { id: "w1", name: "w", L: 5, W: 3, boardType: "moisture" as const, zone: "wet" },
        { id: "w2", name: "w", L: 5, W: 3, boardType: "moisture" as const, zone: "wet" },
      ],
      partitions: [{ id: "p1", area: 40, height: 3, boardType: "normal" as const, layersPerFace: 1 }],
      troughM: 60,
      shadowM: 80,
      hatches: { "40x40": 4, "60x60": 2 },
    };
    const r = computeGypsum(input, cfg.gypsum.catalogue, cfg.gypsum.params);
    const p = priceProject([r], { contingencyPercent: 5, marginPercent: 28, roundingStep: 1, method: "unit", vatPercent: 0 });
    expect(p.cost).toBeCloseTo(21719, 6);
    expect(p.subtotal).toBe(31840);
    expect(r.lines.find((l) => l.key === "board_normal")?.productId).toBe("board_normal");
  });

  it("prefers the chosen brand, then a priced product, and falls back with warnings", () => {
    const base = seededProducts();
    const knauf: CatalogueProduct = { ...base.find((p) => p.role === "board_normal")!, id: "knauf", brand: "Knauf", packs: [{ size: 1, price: 25 }] };
    const chosen = buildEngineConfig({ products: [...base, knauf], rates: seededRates() }, { gypsumBrand: "Knauf" });
    expect(chosen.gypsum.catalogue.boards.normal).toMatchObject({ productId: "knauf", price: 25 });
    // Gypsum brands are offered for gypsum only, never as paint brands.
    expect(chosen.gypsumBrands).toEqual(["Knauf"]);
    expect(chosen.brands).not.toContain("Knauf");

    const empty = buildEngineConfig({ products: [], rates: {} });
    expect(empty.gypsum.catalogue.cChannel.price).toBe(11);
    expect(empty.warnings).toContainEqual({ kind: "missing_product", role: "c_channel" });
    expect(empty.warnings).toContainEqual({ kind: "missing_rate", key: "gypsum.cSpacing" });
  });

  it("lists each brand's paint as its own product (equivalence groups)", () => {
    const base = seededProducts();
    const jotun: CatalogueProduct = { ...base.find((p) => p.role === "wall_finish")!, id: "jotun", brand: "Jotun", packs: [{ size: 18, price: 200 }, { size: 4, price: 50 }] };
    const c = buildEngineConfig({ products: [...base, jotun], rates: seededRates() });
    expect(c.brands).toEqual(["عام", "Jotun"]);
    expect(c.paintProducts.filter((p) => p.role === "wall_finish").map((p) => p.brand)).toEqual(["عام", "Jotun"]);
  });
});

describe("a brand's product added by the owner is used", () => {
  it("prices a Jotun exterior profile even when the generic one is incomplete", async () => {
    const { computeExterior, resolveScope } = await import("@/lib/engine");
    const base = seededProducts().map((p) => (p.role === "profile" ? { ...p, coveragePerPack: null } : p));
    const jotun: CatalogueProduct = { ...base.find((p) => p.role === "profile")!, id: "jotun-profile", brand: "Jotun", coveragePerPack: 40, packs: [{ size: 18, price: 300 }] };
    const cfg = buildEngineConfig({ products: [...base, jotun], rates: seededRates() });
    const scope = resolveScope(cfg.rules.exterior, "profile").scope;
    const r = computeExterior({ area: 300, method: "profile", colours: 1, brand: "عام", scope }, cfg.paintProducts, cfg.exterior);
    const finish = r.lines.find((l) => l.key.startsWith("ext_finish"))!;
    expect(finish.productId).toBe("jotun-profile");
    // 300 m² × 2 coats ÷ (40/18 m²/L) × 1.05 = 283.5 L → 16 × 18 L × 300
    expect(finish.cost).toBe(4800);
  });
});
