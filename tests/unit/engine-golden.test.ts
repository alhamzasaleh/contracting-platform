/**
 * Golden tests — Appendix A.7.
 * Expected values were derived by hand from the Appendix A formulas and
 * cross-checked with an independent calculation (not this code).
 */
import { describe, expect, it } from "vitest";
import {
  computeExterior,
  computeGypsum,
  computeInterior,
  EXTERIOR_PARAMS,
  GYPSUM_CATALOGUE,
  GYPSUM_PARAMS,
  INTERIOR_PARAMS,
  PAINT_PRODUCTS,
  priceProject,
  type CeilingRoom,
  type EngineResult,
  type PaintProduct,
} from "@/lib/engine";

const qty = (r: EngineResult, key: string) => r.lines.find((l) => l.key === key)?.qty;
const cost = (r: EngineResult, key: string) => r.lines.find((l) => l.key === key)?.cost;
const PRICE = { contingencyPercent: 5, marginPercent: 28, roundingStep: 1, method: "unit" as const, vatPercent: 0 };

// One villa: ceilings 400 m² (fire 25 kitchen, moisture 30 baths), real room sizes.
const ROOMS: CeilingRoom[] = [
  { id: "majlis", name: "مجلس", L: 10, W: 8, boardType: "normal" },
  { id: "living", name: "صالة", L: 10, W: 10, boardType: "normal" },
  { id: "bed1", name: "نوم 1", L: 5, W: 5, boardType: "normal" },
  { id: "bed2", name: "نوم 2", L: 5, W: 5, boardType: "normal" },
  { id: "bed3", name: "نوم 3", L: 5, W: 5, boardType: "normal" },
  { id: "bed4", name: "نوم 4", L: 5, W: 5, boardType: "normal" },
  { id: "corridor", name: "ممر", L: 13, W: 5, boardType: "normal" },
  { id: "kitchen", name: "مطبخ", L: 5, W: 5, boardType: "fire", zone: "kitchen" },
  { id: "bath1", name: "حمام 1", L: 5, W: 3, boardType: "moisture", zone: "wet" },
  { id: "bath2", name: "حمام 2", L: 5, W: 3, boardType: "moisture", zone: "wet" },
];

const GYPSUM_INPUT = {
  rooms: ROOMS,
  partitions: [{ id: "p1", area: 40, height: 3, boardType: "normal" as const, layersPerFace: 1 }],
  troughM: 60,
  shadowM: 80,
  hatches: { "40x40": 4, "60x60": 2 },
};

describe("golden — gypsum villa (A.7)", () => {
  const r = computeGypsum(GYPSUM_INPUT, GYPSUM_CATALOGUE, GYPSUM_PARAMS);

  it("derives areas from rooms", () => {
    expect(r.areas).toEqual({ ceilings: 400, partitions: 40 });
    expect(r.status).toBe("measured");
  });

  it("counts boards per type (area × layers ÷ 2.88 × 1.05, rounded up)", () => {
    // normal: (345 + 60 m × 0.6 trough + 40 × 2 partition faces) = 461 m² → 168.07 → 169
    expect(qty(r, "board_normal")).toBe(169);
    expect(qty(r, "board_moisture")).toBe(11); // 30 → 10.94 → 11
    expect(qty(r, "board_fire")).toBe(10); // 25 → 9.11 → 10
  });

  it("lays metal runs per room onto 3 m bars", () => {
    expect(qty(r, "c_channel")).toBe(160);
    expect(qty(r, "omega")).toBe(432);
    expect(qty(r, "edge_angle")).toBe(88);
    expect(qty(r, "trough_angle")).toBe(40); // 60 × 2 = 120 m
    expect(qty(r, "shadow")).toBe(27); // 80 m
    expect(qty(r, "studs")).toBe(24); // ceil(13.33 ÷ 0.6) + 1 = 24 studs × 3 m
    expect(qty(r, "tracks")).toBe(9); // 2 × 13.33 m
  });

  it("counts hangers, rods, washers, anchors and clips", () => {
    const rod = r.lines.find((l) => l.key === "rod")!;
    expect(rod.inputs.hangers).toBe(592); // per-room C runs × (ceil(L ÷ 1) + 1) + 60 trough hangers
    expect(rod.qty).toBe(119); // 0.55 m pieces, 5 per 3 m rod
    expect(qty(r, "washers")).toBe(6);
    expect(qty(r, "anchors")).toBe(6);
    expect(r.lines.find((l) => l.key === "clips")!.inputs.crossings).toBe(1256);
    expect(qty(r, "clips")).toBe(13);
  });

  it("counts screws, tape and compound per finished m²", () => {
    expect(qty(r, "angle_screws")).toBe(7); // perimeter 244 m × 2.5
    expect(qty(r, "board_screws")).toBe(8); // 480 m² × 15 × 1.05 = 7560
    expect(qty(r, "joint_tape")).toBe(8); // 480 × 1.4 × 1.05 = 705.6 m ÷ 90
    expect(qty(r, "joint_compound")).toBe(12); // 480 × 0.45 × 1.05 = 226.8 kg ÷ 20
  });

  it("prices materials, labour and hatches", () => {
    const p = priceProject([r], PRICE);
    expect(p.materials).toBeCloseTo(14259, 6);
    expect(p.labour).toBeCloseTo(6940, 6); // 400×12 + 40×15 + 60×15 + 80×8
    expect(p.hatches).toBe(520); // 4×75 + 2×110
    expect(p.cost).toBeCloseTo(21719, 6);
  });

  it("gives price per m² per work type (contingency 5 %, margin 28 % on price, round up 1 SAR)", () => {
    const p = priceProject([r], PRICE);
    const ceilings = p.byWorkType.find((w) => w.workType === "ceilings")!;
    const partitions = p.byWorkType.find((w) => w.workType === "partitions")!;
    expect(ceilings.cost).toBeCloseTo(19920.1273, 3);
    expect(ceilings.rawPrice).toBeCloseTo(29050.1856, 3);
    expect(ceilings.pricePerM2).toBe(73);
    expect(partitions.cost).toBeCloseTo(1798.8727, 3);
    expect(partitions.pricePerM2).toBe(66);
    expect(p.subtotal).toBe(31840); // 73 × 400 + 66 × 40
    expect(p.marginPercent).toBeGreaterThanOrEqual(28);
    expect(p.targetMarkupPercent).toBeCloseTo(38.888, 2);
  });

  it("recalculates when one zone is overridden (wet → fire board)", () => {
    const o = computeGypsum({ ...GYPSUM_INPUT, zoneOverrides: { wet: { boardType: "fire" } } }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(qty(o, "board_moisture")).toBeUndefined();
    expect(qty(o, "board_fire")).toBe(21); // (25 + 30) ÷ 2.88 × 1.05 = 20.05 → 21
    expect(qty(o, "board_normal")).toBe(169);
  });

  it("switches suspension to vertical C hangers (no washers)", () => {
    const v = computeGypsum(GYPSUM_INPUT, GYPSUM_CATALOGUE, { ...GYPSUM_PARAMS, suspension: "vertical_c" });
    expect(qty(v, "washers")).toBeUndefined();
    expect(qty(v, "vertical_c")).toBe(119);
  });

  it("excludes materials for execute-only projects", () => {
    const e = computeGypsum({ ...GYPSUM_INPUT, executeOnly: true }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(e.lines.every((l) => l.group !== "material")).toBe(true);
    expect(priceProject([e], PRICE).labour).toBeCloseTo(6940, 6);
  });

  it("estimates from total areas in quick mode", () => {
    const q = computeGypsum({ quickAreas: { normal: 345, fire: 25, moisture: 30 }, troughM: 60 }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(q.status).toBe("estimated");
    expect(q.warnings).toContain("quick_estimate");
    expect(qty(q, "board_moisture")).toBe(11);
  });
});

// Interior: walls 600 (wet 40, decorative 30), ceilings 250, new full system, Jotun, 2 colours.
const JOTUN: PaintProduct[] = [
  { id: "j_putty", brand: "Jotun", role: "putty", name: "Jotun putty 20 kg", unit: "kg", refPackSize: 20, coveragePerPack: 25, packs: [{ size: 20, price: 45 }], colourSpecific: false },
  { id: "j_primer", brand: "Jotun", role: "primer", name: "Jotun primer 18 L", unit: "L", refPackSize: 18, coveragePerPack: 140, packs: [{ size: 18, price: 120 }], colourSpecific: false },
  { id: "j_finish", brand: "Jotun", role: "wall_finish", name: "Jotun Fenomastic 18 L", unit: "L", refPackSize: 18, coveragePerPack: 120, packs: [{ size: 18, price: 180 }, { size: 4, price: 45 }], colourSpecific: true },
  { id: "j_ceiling", brand: "Jotun", role: "ceiling_paint", name: "Jotun ceiling 18 L", unit: "L", refPackSize: 18, coveragePerPack: 130, packs: [{ size: 18, price: 140 }], colourSpecific: true },
  { id: "j_moist", brand: "Jotun", role: "moisture", name: "Jotun moisture 18 L", unit: "L", refPackSize: 18, coveragePerPack: 110, packs: [{ size: 18, price: 230 }], colourSpecific: true },
  { id: "j_deco", brand: "Jotun", role: "decorative", name: "Jotun decorative 5 L", unit: "L", refPackSize: 5, coveragePerPack: 15, packs: [{ size: 5, price: 160 }], colourSpecific: true },
];
const JAZEERA_FINISH: PaintProduct = { id: "aj_finish", brand: "Al-Jazeera", role: "wall_finish", name: "Al-Jazeera emulsion 18 L", unit: "L", refPackSize: 18, coveragePerPack: 110, packs: [{ size: 18, price: 150 }], colourSpecific: true };

const INTERIOR = {
  wallArea: 600,
  ceilingArea: 250,
  zones: [
    { id: "wet", kind: "wet" as const, wallArea: 40 },
    { id: "decorative", kind: "decorative" as const, wallArea: 30 },
  ],
  colours: 2,
  colourNames: ["أبيض كريمي", "رمادي فاتح"],
  variant: "new" as const,
  brand: "Jotun",
};

describe("golden — interior paint (A.7)", () => {
  const r = computeInterior(INTERIOR, [...JOTUN, JAZEERA_FINISH], INTERIOR_PARAMS);

  it("computes putty and primer on all surfaces", () => {
    expect(qty(r, "putty")).toBe(61); // (600×2 + 250×1) ÷ 1.25 kg/m² × 1.05 = 1218 kg ÷ 20
    expect(cost(r, "putty")).toBe(2745);
    expect(qty(r, "primer")).toBe(7); // 850 × 18 ÷ 140 × 1.05 = 114.75 L
  });

  it("buys wall finish per colour with the cheapest packs", () => {
    const colours = r.lines.filter((l) => l.key.startsWith("wall_finish_"));
    expect(colours).toHaveLength(2);
    for (const c of colours) {
      // 265 m² × 2 coats × 18 ÷ 120 × 1.05 = 83.475 L → 4×18 + 3×4 L
      expect(c.need).toBeCloseTo(83.475, 3);
      expect(c.cost).toBe(855);
      expect(c.purchase).toMatchObject({ kind: "packs", packs: [{ size: 18, count: 4 }, { size: 4, count: 3 }] });
    }
  });

  it("handles ceilings, wet and decorative zones", () => {
    expect(cost(r, "ceiling_paint")).toBe(700); // 500 m²-coats → 72.69 L → 5 × 18 L
    expect(cost(r, "zone_wet")).toBe(230); // 80 m²-coats → 13.75 L → 1 pack
    expect(cost(r, "zone_decorative")).toBe(480); // 30 m² ÷ 3 m²/L × 1.05 = 10.5 L → 3 × 5 L
  });

  it("adds sundries and labour", () => {
    expect(cost(r, "sandpaper")).toBe(400);
    expect(cost(r, "nylon")).toBe(175);
    expect(cost(r, "masking_tape")).toBe(90);
    expect(cost(r, "consumables")).toBe(425);
    expect(cost(r, "labour_walls")).toBe(7200);
    expect(cost(r, "labour_ceilings")).toBe(3500);
    expect(cost(r, "labour_decorative")).toBe(450);
  });

  it("prices walls and ceilings separately", () => {
    const p = priceProject([r], PRICE);
    expect(p.materials).toBeCloseTo(7795, 6);
    expect(p.labour).toBeCloseTo(11150, 6);
    const walls = p.byWorkType.find((w) => w.workType === "walls")!;
    const ceilings = p.byWorkType.find((w) => w.workType === "ceilings")!;
    expect(walls.cost).toBeCloseTo(13629.2292, 3);
    expect(walls.pricePerM2).toBe(34);
    expect(ceilings.cost).toBeCloseTo(5315.7708, 3);
    expect(ceilings.pricePerM2).toBe(32);
    expect(p.subtotal).toBe(28400);
  });

  it("recalculates when switching brand (Al-Jazeera coverage and packs)", () => {
    const aj = computeInterior({ ...INTERIOR, brand: "Al-Jazeera" }, [...JOTUN, JAZEERA_FINISH], INTERIOR_PARAMS);
    const colours = aj.lines.filter((l) => l.key.startsWith("wall_finish_"));
    for (const c of colours) {
      expect(c.productId).toBe("aj_finish");
      expect(c.need).toBeCloseTo(91.0636, 3); // 530 × 18 ÷ 110 × 1.05
      expect(c.cost).toBe(900); // 6 × 18 L × 150
    }
    // Components without an Al-Jazeera equivalent fall back, with a warning.
    expect(aj.warnings).toContain("brand_fallback_putty");
  });

  it("lets ceilings have their own colours (not necessarily white)", () => {
    const two = computeInterior({ ...INTERIOR, ceilingColours: 2, ceilingColourNames: ["أبيض", "بيج"] }, JOTUN, INTERIOR_PARAMS);
    const lines = two.lines.filter((l) => l.key.startsWith("ceiling_paint"));
    expect(lines.map((l) => l.colour)).toEqual(["أبيض", "بيج"]);
    // 125 m² × 2 coats each → 36.35 L → 3 × 18 L per colour (rounded up per colour)
    expect(lines.map((l) => l.cost)).toEqual([420, 420]);
  });

  it("applies VAT only when the company is VAT-registered", () => {
    expect(priceProject([r], { ...PRICE, vatPercent: 0 }).vat).toBe(0);
    expect(priceProject([r], { ...PRICE, vatPercent: 15 }).vat).toBe(4260);
  });
});

describe("golden — exterior method switch (roller → spray)", () => {
  const base = { area: 300, colours: 1, brand: "Generic" };

  it("roller: acrylic 2 coats, 5 % waste, application labour 6", () => {
    const r = computeExterior({ ...base, method: "roller" }, PAINT_PRODUCTS, EXTERIOR_PARAMS);
    expect(cost(r, "ext_primer")).toBe(270);
    expect(cost(r, "ext_putty")).toBe(1170);
    expect(r.lines.find((l) => l.key.startsWith("ext_finish_"))!.cost).toBe(1700);
    expect(priceProject([r], PRICE).cost).toBeCloseTo(6140, 6);
  });

  it("spray: spray acrylic, 15 % waste, spray labour 4.5", () => {
    const r = computeExterior({ ...base, method: "spray" }, PAINT_PRODUCTS, EXTERIOR_PARAMS);
    const finish = r.lines.find((l) => l.key.startsWith("ext_finish_"))!;
    expect(finish.productId).toBe("spray_acrylic");
    expect(finish.inputs.waste).toBe(15);
    expect(finish.cost).toBe(1725); // 600 × 18 ÷ 140 × 1.15 = 88.71 L → 5 packs
    expect(cost(r, "labour_spray")).toBe(1350);
    expect(cost(r, "labour_application")).toBeUndefined();
    expect(priceProject([r], PRICE).cost).toBeCloseTo(5715, 6);
  });
});
