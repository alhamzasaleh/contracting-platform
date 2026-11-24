/** Pricing by steps — owner's agreed model. */
import { describe, expect, it } from "vitest";
import type { CatalogueProduct } from "@/lib/engine";
import { defaultSelection, EMPTY_QUANTITIES, priceSelection, type PricingContext, type Quantities } from "@/lib/pricing";
import { seededProducts, seededRates } from "./helpers/seed";

const ctx = (extra: CatalogueProduct[] = [], patch: Partial<PricingContext> = {}): PricingContext => ({
  catalogue: { products: [...seededProducts(), ...extra], rates: seededRates() },
  external: [{ id: "ext1", name: "مقاول أبو فهد", service: "exterior", basis: "external_per_unit", rate: 5 }],
  crew: [
    { id: "e1", name: "عامل 1", job: "دهان", perDay: 150 },
    { id: "e2", name: "عامل 2", job: "دهان", perDay: 130 },
  ],
  vatPercent: 0,
  ...patch,
});
const Q = (q: Partial<Quantities>): Quantities => ({ ...EMPTY_QUANTITIES, ...q });
const keys = (o: ReturnType<typeof priceSelection>) => o.result.lines.map((l) => l.key);

const JOTUN_PROFILE: CatalogueProduct = {
  id: "jotun-profile", lineId: "line-profile", role: "profile", brand: "جوتن Jotun", name: "بروفايل خارجي", unit: "L",
  refPackSize: 1, coveragePerPack: 10 / 30, surfaceFactor: 1, lengthM: null, contentsPerPack: null, areaM2: null,
  colourSpecific: true, wastePercent: null, packs: [{ size: 30, price: 30 }],
};

describe("interior — defaults reproduce the golden interior paint", () => {
  const c = ctx();
  const sel = defaultSelection("interior", c.catalogue);
  const q = Q({ walls: 600, ceilings: 250, wet: 40, decorative: 30, colours: 2 });

  it("starts from the template coats (putty 2/1, primer 1/1, finish 2, ceiling 2)", () => {
    expect(sel.steps.putty.coats).toEqual({ walls: 2, ceilings: 1 });
    expect(sel.steps.primer.coats).toEqual({ walls: 1, ceilings: 1 });
    expect(sel.steps.sealer.coats).toEqual({ walls: 0 });
  });

  it("prices putty and primer like the golden test", () => {
    const o = priceSelection(sel, q, c);
    expect(o.result.lines.find((l) => l.key === "putty")?.cost).toBe(2745);
    expect(o.result.lines.find((l) => l.key === "primer")?.qty).toBe(7);
    expect(o.problems).toEqual([]);
  });

  it("coats are chosen per client: no primer on ceilings, 3 finish coats", () => {
    const s = structuredClone(sel);
    s.steps.primer.coats = { walls: 1, ceilings: 0 };
    s.steps.wall_finish.coats = { walls: 3 };
    const o = priceSelection(s, q, c);
    const primer = o.result.lines.find((l) => l.key === "primer")!;
    expect(primer.inputs.areaCoats).toBe(600); // walls only
    const finish = o.result.lines.find((l) => l.key.startsWith("wall_finish"))!;
    expect(finish.inputs.areaCoats).toBe(265 * 3);
  });

  it("'without' (0 coats) removes the step; the sealer is added only when chosen", () => {
    const s = structuredClone(sel);
    s.steps.putty.coats = { walls: 0, ceilings: 0 };
    s.steps.sealer.coats = { walls: 1 };
    const o = priceSelection(s, q, c);
    expect(keys(o)).not.toContain("putty");
    expect(keys(o)).not.toContain("sandpaper"); // sanding follows putty
    // no sealer product in the seed → shown as a problem and a red line, not dropped
    expect(o.problems).toContainEqual(expect.objectContaining({ step: "sealer", role: "sealer" }));
  });
});

describe("exterior — the owner's profile case", () => {
  it("prices Jotun profile (30 L covers 10 m², 30 SAR), 1 coat, no putty", () => {
    const c = ctx([JOTUN_PROFILE]);
    const sel = defaultSelection("exterior", c.catalogue);
    sel.options.method = "profile";
    sel.steps.finish_profile = { lineId: "line-profile", brand: "جوتن Jotun", coats: { facades: 1 }, on: true };
    const o = priceSelection(sel, Q({ facade: 300 }), c);
    const finish = o.result.lines.find((l) => l.key.startsWith("ext_finish"))!;
    expect(finish.productId).toBe("jotun-profile");
    // 300 × 1 ÷ (10/30) × 1.05 = 945 L → 32 × 30 L × 30 = 960
    expect(finish.cost).toBe(960);
    expect(keys(o)).not.toContain("ext_putty");
    expect(keys(o)).not.toContain("labour_sanding_putty");
  });

  it("profile is one coat by default even when the acrylic finish rate says 2 (owner: profile is a single coat)", () => {
    const c = ctx();
    expect(c.catalogue.rates["exterior.coats.finish"]).toBe(2);
    const sel = defaultSelection("exterior", c.catalogue);
    expect(sel.steps.finish_profile.coats).toEqual({ facades: 1 });
    expect(sel.steps.finish_roller.coats).toEqual({ facades: 2 });
  });

  it("an incomplete chosen product is reported, never silently dropped", () => {
    const c = ctx(); // seeded generic profile has no price
    const sel = defaultSelection("exterior", c.catalogue);
    sel.options.method = "profile";
    const o = priceSelection(sel, Q({ facade: 300 }), c);
    expect(o.problems).toContainEqual(expect.objectContaining({ step: "finish_profile", role: "profile" }));
  });
});

describe("labour source", () => {
  const c = ctx();
  const sel = defaultSelection("exterior", c.catalogue);
  const q = Q({ facade: 300 });

  it("template rates by default (application 6 + sanding & putty 4)", () => {
    const o = priceSelection(sel, q, c);
    expect(o.price.labour).toBe(300 * 6 + 300 * 4);
  });

  it("external contractor at his rate per m² replaces our labour rates", () => {
    const o = priceSelection({ ...sel, labour: { source: "external", externalId: "ext1" } }, q, c);
    expect(o.price.labour).toBe(300 * 5);
  });

  it("our own crew: days = area ÷ productivity (100 m²/day) × crew daily cost (150 + 130)", () => {
    const o = priceSelection({ ...sel, labour: { source: "inhouse", crew: ["e1", "e2"] } }, q, c);
    expect(o.price.labour).toBeCloseTo(3 * 280, 6);
  });
});

describe("gypsum — brands for boards and metal", () => {
  it("uses the chosen board brand and metal brand", () => {
    const base = seededProducts();
    const mada = { ...base.find((p) => p.role === "board_normal")!, id: "mada-board", brand: "مدى", packs: [{ size: 2.88, price: 20 }] };
    const knaufC = { ...base.find((p) => p.role === "c_channel")!, id: "knauf-c", brand: "كناوف", packs: [{ size: 3, price: 13 }] };
    const c = ctx([mada, knaufC]);
    const sel = defaultSelection("gypsum", c.catalogue);
    sel.steps.board_normal.brand = "مدى";
    sel.steps.metal.brand = "كناوف";
    const o = priceSelection(sel, Q({ ceilNormal: 100 }), c);
    expect(o.result.lines.find((l) => l.key === "board_normal")?.unitPrice).toBe(20);
    expect(o.result.lines.find((l) => l.key === "c_channel")?.unitPrice).toBe(13);
  });

  it("options as buttons: hanging height and C spacing change quantities", () => {
    const c = ctx();
    const sel = defaultSelection("gypsum", c.catalogue);
    const a = priceSelection(sel, Q({ ceilNormal: 100 }), c);
    const b = priceSelection({ ...sel, options: { ...sel.options, cSpacing: 0.6 } }, Q({ ceilNormal: 100 }), c);
    expect(b.result.lines.find((l) => l.key === "c_channel")!.qty).toBeGreaterThan(a.result.lines.find((l) => l.key === "c_channel")!.qty);
  });
});

describe("only what the job needs is reported", () => {
  it("no vertical hangers, studs or tracks reported for a ceiling with rods", () => {
    const base = seededProducts().filter((p) => !["vertical_hanger", "stud", "track"].includes(p.role ?? ""));
    const c: PricingContext = { catalogue: { products: base, rates: seededRates() }, external: [], crew: [], vatPercent: 0 };
    const o = priceSelection(defaultSelection("gypsum", c.catalogue), Q({ ceilNormal: 100 }), c);
    expect(o.problems.map((p) => p.role)).toEqual([]);
  });
});

describe("coats buttons", () => {
  it("every step offers none / 1 / 2 / 3 coats (owner)", async () => {
    const { STEPS } = await import("@/lib/pricing");
    const slots = Object.values(STEPS).flat().flatMap((s) => s.coats ?? []);
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((k) => k.max))).toEqual(new Set([3]));
  });
});

describe("risk reserve and rounding", () => {
  it("the risk reserve is chosen per client and raises the cost before the margin", () => {
    const c = ctx();
    const sel = defaultSelection("exterior", c.catalogue);
    const a = priceSelection(sel, Q({ facade: 300 }), c);
    const b = priceSelection({ ...sel, contingencyPercent: 10 }, Q({ facade: 300 }), c);
    expect(b.price.costWithContingency).toBeCloseTo(a.price.cost * 1.1, 6);
  });

  it("achieved margin is above the target only because price per m² is rounded up", () => {
    const c = ctx();
    const sel = { ...defaultSelection("exterior", c.catalogue), marginPercent: 25 };
    const fine = { ...c, catalogue: { ...c.catalogue, rates: { ...c.catalogue.rates, "commercial.roundingStep": 0.01 } } };
    expect(priceSelection(sel, Q({ facade: 300 }), fine).price.marginPercent).toBeCloseTo(25, 1);
    expect(priceSelection(sel, Q({ facade: 300 }), c).price.marginPercent).toBeGreaterThan(25);
  });
});

describe("project type (§3.5)", () => {
  const c = ctx();
  const base = defaultSelection("interior", c.catalogue);
  const q = Q({ walls: 300, ceilings: 100 });
  const withType = (t: "full" | "labour" | "supply") => priceSelection({ ...base, options: { ...base.options, projectType: t } }, q, c);

  it("labour only: no materials (client supplies them), labour stays", () => {
    const o = withType("labour");
    expect(o.price.materials).toBe(0);
    expect(o.price.labour).toBeGreaterThan(0);
    expect(o.problems).toEqual([]);
  });

  it("supply only: materials without labour", () => {
    const o = withType("supply");
    expect(o.price.labour).toBe(0);
    expect(o.price.materials).toBeCloseTo(withType("full").price.materials, 6);
  });
});
