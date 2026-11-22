/** Scope of work: included / not included per client (owner request). */
import { describe, expect, it } from "vitest";
import {
  computeExterior,
  computeInterior,
  EXTERIOR_PARAMS,
  EXTERIOR_RULES,
  INTERIOR_PARAMS,
  INTERIOR_RULES,
  PAINT_PRODUCTS,
  resolveScope,
  type PaintProduct,
} from "@/lib/engine";

const SEALER: PaintProduct = { id: "sealer", brand: "Generic", role: "sealer", name: "Cement sealer 20 kg", unit: "kg", refPackSize: 20, coveragePerPack: 40, packs: [{ size: 20, price: 60 }], colourSpecific: false };
const PRODUCTS = [...PAINT_PRODUCTS, SEALER];
const INTERIOR = { wallArea: 600, ceilingArea: 250, colours: 1, variant: "new" as const, brand: "Generic" };
const keys = (lines: { key: string }[]) => lines.map((l) => l.key);

describe("resolveScope", () => {
  it("includes 'on' items, excludes 'off' items, and never drops 'always' items", () => {
    const { scope } = resolveScope(INTERIOR_RULES, "new", { wall_finish: false });
    expect(scope).toMatchObject({ putty: true, primer: true, sealer: false, wall_finish: true });
  });

  it("follows the client's choices and drops sanding when putty is not included", () => {
    const { scope } = resolveScope(INTERIOR_RULES, "new", { putty: false, primer: false, sealer: true });
    expect(scope).toMatchObject({ putty: false, sandpaper: false, primer: false, sealer: true });
  });

  it("profile finishes don't take exterior putty", () => {
    expect(resolveScope(EXTERIOR_RULES, "profile").scope.ext_putty).toBe(false);
    expect(resolveScope(EXTERIOR_RULES, "roller").scope.ext_putty).toBe(true);
    // even if someone ticks it, it doesn't apply to profile
    expect(resolveScope(EXTERIOR_RULES, "profile", { ext_putty: true }).scope.ext_putty).toBe(false);
  });
});

describe("engine honours the scope", () => {
  it("full interior system by default; sealer only when asked", () => {
    const r = computeInterior(INTERIOR, PRODUCTS, INTERIOR_PARAMS);
    expect(keys(r.lines)).toEqual(expect.arrayContaining(["putty", "primer", "sandpaper"]));
    expect(keys(r.lines)).not.toContain("sealer");

    const s = computeInterior({ ...INTERIOR, scope: resolveScope(INTERIOR_RULES, "new", { sealer: true }).scope }, PRODUCTS, INTERIOR_PARAMS);
    const sealer = s.lines.find((l) => l.key === "sealer")!;
    // 600 m² walls × 1 coat ÷ 2 m²/kg × 1.05 = 315 kg → 16 bags × 60
    expect(sealer.need).toBeCloseTo(315, 3);
    expect(sealer.cost).toBe(960);
  });

  it("client without primer and putty: no primer, putty or sandpaper lines", () => {
    const scope = resolveScope(INTERIOR_RULES, "new", { primer: false, putty: false }).scope;
    const r = computeInterior({ ...INTERIOR, scope }, PRODUCTS, INTERIOR_PARAMS);
    expect(keys(r.lines)).not.toEqual(expect.arrayContaining(["primer"]));
    expect(keys(r.lines).filter((k) => ["primer", "putty", "sandpaper"].includes(k))).toEqual([]);
    expect(keys(r.lines)).toContain("wall_finish_لون 1");
  });

  it("exterior profile: no putty and no sanding/putty labour", () => {
    const products = [...PRODUCTS, { ...PAINT_PRODUCTS.find((p) => p.role === "acrylic")!, id: "profile", role: "profile" as const }];
    const scope = resolveScope(EXTERIOR_RULES, "profile").scope;
    const r = computeExterior({ area: 300, method: "profile", colours: 1, brand: "Generic", scope }, products, EXTERIOR_PARAMS);
    expect(keys(r.lines)).not.toContain("ext_putty");
    expect(keys(r.lines)).not.toContain("labour_sanding_putty");
    expect(keys(r.lines)).toContain("ext_primer");
  });
});

describe("owner can make anything optional", () => {
  it("drops the finish coat when the owner excludes it", () => {
    const rules = INTERIOR_RULES.map((r) => (r.role === "wall_finish" ? { ...r, inclusion: "on" as const } : r));
    const scope = resolveScope(rules, "new", { wall_finish: false }).scope;
    const r = computeInterior({ ...INTERIOR, scope }, PRODUCTS, INTERIOR_PARAMS);
    expect(keys(r.lines).some((k) => k.startsWith("wall_finish"))).toBe(false);
  });

  it("drops a gypsum part (e.g. edge angle supplied by the client)", async () => {
    const { computeGypsum, GYPSUM_CATALOGUE, GYPSUM_PARAMS, GYPSUM_RULES } = await import("@/lib/engine");
    const rules = GYPSUM_RULES.map((r) => (r.role === "edge_angle" ? { ...r, inclusion: "on" as const } : r));
    const scope = resolveScope(rules, "rod", { edge_angle: false }).scope;
    const r = computeGypsum({ quickAreas: { normal: 100 }, scope }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(keys(r.lines)).not.toContain("edge_angle");
    expect(keys(r.lines)).toContain("c_channel");
    expect(keys(r.lines)).toContain("labour_ceilings");
  });
});
