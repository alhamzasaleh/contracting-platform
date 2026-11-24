import { describe, expect, it } from "vitest";
import { defaultSelection, EMPTY_QUANTITIES, priceSelection, type PricingContext } from "@/lib/pricing";
import { buildSnapshot } from "@/lib/quotes";
import { buyParts, materialRows, needsFromLines, type QtySource } from "@/lib/quotes/materials";
import { seededProducts, seededRates } from "./helpers/seed";

/**
 * Bill of quantities (owner, Nov 2026): every material with how many packs of which size to buy,
 * the quantity actually needed and the expected leftover — per colour — from the frozen quote.
 */

const paint = (over: Partial<QtySource["items"][number]> = {}) => ({
  key: "ext_finish_لون 1",
  label: "بروفايل / تكسير — جوتن (لون 1)",
  brand: "جوتن",
  colour: "لون 1",
  packs: [{ size: 18, count: 2 }, { size: 4, count: 1 }],
  qty: 3,
  unit: "pack",
  leftover: 2.5,
  cost: 400,
  productId: "p-profile",
  ...over,
});

describe("buyParts — what to buy, in words the purchaser understands", () => {
  it("packs: count × size with the size's unit", () => {
    expect(buyParts({ kind: "packs", packs: [{ size: 18, count: 2, price: 180 }, { size: 4, count: 1, price: 45 }], volume: 40, leftover: 2.5 }, "L", "pack", 3)).toEqual([
      { count: 2, size: 18, sizeUnit: "L", unit: "pack" },
      { count: 1, size: 4, sizeUnit: "L", unit: "pack" },
    ]);
  });
  it("bars: count × stock length in metres", () => {
    expect(buyParts({ kind: "bars", bars: 12, stockLength: 3.6, offcuts: [] }, "m", "bar", 12)).toEqual([{ count: 12, size: 3.6, sizeUnit: "m", unit: "bar" }]);
  });
  it("boxes: count × contents; boards: count only", () => {
    expect(buyParts({ kind: "units", count: 7, perPack: 1000 }, "pcs", "box", 7)).toEqual([{ count: 7, size: 1000, sizeUnit: "pcs", unit: "box" }]);
    expect(buyParts({ kind: "units", count: 40 }, "m2", "board", 40)).toEqual([{ count: 40, size: null, sizeUnit: null, unit: "board" }]);
  });
});

describe("materialRows — the printable bill of quantities", () => {
  const src: QtySource = {
    items: [paint(), paint({ key: "ext_finish_لون 2", label: "بروفايل / تكسير — جوتن (لون 2)", colour: "لون 2", packs: [{ size: 18, count: 1 }], qty: 1, leftover: 4, cost: 180 })],
    needs: [
      { key: "ext_finish_لون 1", need: 37.5, needUnit: "L", perPack: null },
      { key: "ext_finish_لون 2", need: 14, needUnit: "L", perPack: null },
    ],
  };

  it("one row per product, size and colour with packs to buy, the need it covers and the leftover", () => {
    const rows = materialRows(src, { prices: false });
    expect(rows.map((r) => [r.material, r.brand, r.colour, r.size, r.sizeUnit, r.count, r.need, r.leftover])).toEqual([
      ["بروفايل / تكسير", "جوتن", "لون 1", 18, "L", 2, 36, 0],
      ["بروفايل / تكسير", "جوتن", "لون 1", 4, "L", 1, 1.5, 2.5],
      ["بروفايل / تكسير", "جوتن", "لون 2", 18, "L", 1, 14, 4],
    ]);
  });

  it("the same product, size and colour from two lines is one row (quantities added)", () => {
    const rows = materialRows(
      {
        items: [
          { key: "board_a", label: "ألواح جبس عادي", brand: "كناوف", colour: null, packs: [], qty: 10, unit: "board", leftover: null, productId: "b1" },
          { key: "board_b", label: "ألواح جبس عادي", brand: "كناوف", colour: null, packs: [], qty: 5, unit: "board", leftover: null, productId: "b1" },
        ],
        needs: [
          { key: "board_a", need: 27, needUnit: "m2", perPack: null },
          { key: "board_b", need: 13, needUnit: "m2", perPack: null },
        ],
      },
      { prices: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 15, need: 40, needUnit: "m2", size: null, leftover: null });
  });

  it("without prices no row carries any price field — even when the source had costs", () => {
    for (const r of materialRows(src, { prices: false })) {
      expect(Object.keys(r).filter((k) => /price|cost/i.test(k))).toEqual([]);
    }
  });

  it("with prices: the quoted cost split by volume between pack sizes", () => {
    const rows = materialRows(src, { prices: true });
    expect(rows[0].cost).toBeCloseTo((400 * 36) / 40, 2);
    expect(rows[0].unitPrice).toBeCloseTo(180, 2);
    expect(rows[1].cost).toBeCloseTo((400 * 4) / 40, 2);
    expect(rows[2].cost).toBe(180);
  });

  it("subtracts what was already bought for the project, per pack size and colour", () => {
    const stock = [
      { id: "i18", name: "بروفايل / تكسير — جوتن (لون 1) — جوتن (18)", unit: "pack", product_id: "p-profile" },
      { id: "i4", name: "بروفايل / تكسير — جوتن (لون 1) — جوتن (4)", unit: "pack", product_id: "p-profile" },
    ];
    const rows = materialRows(src, {
      prices: false,
      bought: { stock, rows: [{ item_id: "i18", product_id: "p-profile", colour: "لون 1", unit: "pack", quantity: 1 }] },
    });
    expect(rows.map((r) => [r.size, r.colour, r.bought, r.remaining])).toEqual([
      [18, "لون 1", 1, 1],
      [4, "لون 1", 0, 1],
      [18, "لون 2", 0, 1],
    ]);
  });

  it("from a real priced quote: unpriced products (profile without a price) still list their packs", () => {
    const products = seededProducts();
    const ctx: PricingContext = { catalogue: { products, rates: seededRates() }, external: [], crew: [], vatPercent: 15 };
    const q = { ...EMPTY_QUANTITIES, facade: 300, extColours: 2 };
    const sel = { ...defaultSelection("exterior", ctx.catalogue) };
    sel.options = { ...sel.options, method: "profile" };
    const o = priceSelection(sel, q, ctx);
    const snap = buildSnapshot(sel, q, o, { discountPercent: 0, method: "unit", estimated: false, vatPercent: 15, catalogue: ctx.catalogue });
    const finish = snap.purchaseList.filter((p) => p.key.startsWith("ext_finish"));
    expect(finish).toHaveLength(2);
    const rows = materialRows({ items: snap.purchaseList, needs: needsFromLines(snap.lines) }, { prices: false });
    const profile = rows.filter((r) => r.colour);
    expect(profile).toHaveLength(2);
    expect(profile[0]).toMatchObject({ size: 18, sizeUnit: "L", unit: "pack" });
    expect(profile[0].count).toBeGreaterThan(0);
    expect(profile[0].need).toBeGreaterThan(0);
  });
});

describe("bill of quantities PDF", async () => {
  const { STAFF_DOCS, pdfDocName } = await import("@/lib/pdf-docs");
  it("the quote / project table (quantities or priced) may be rendered as PDF — nothing else under it", () => {
    for (const ok of ["quotations/Q-2026-001/materials", "quotations/Q-2026-001/materials/priced", "contracts/C-2026-003/materials", "contracts/C-2026-003/materials/priced"]) expect(STAFF_DOCS.test(ok)).toBe(true);
    for (const bad of ["invoices/INV-2026-001/materials", "quotations/Q-2026-001/materials/x", "quotations/Q-2026-001/materials/", "contracts/C-2026-003/priced", "quotations/Q-2026-001/materials/../../x"]) expect(STAFF_DOCS.test(bad)).toBe(false);
  });
  it("names the download after the document and the table", () => {
    expect(pdfDocName("quotations/Q-2026-001/materials/priced")).toBe("Q-2026-001-materials-priced");
    expect(pdfDocName("quotations/Q-2026-001")).toBe("Q-2026-001");
    expect(pdfDocName("payroll/2026-11")).toBe("2026-11");
  });
});

describe("review fixes (Nov 2026)", () => {
  const products = seededProducts();
  const ctx: PricingContext = { catalogue: { products, rates: seededRates() }, external: [], crew: [], vatPercent: 15 };
  const snapOf = (kind: "gypsum" | "interior" | "exterior", q: typeof EMPTY_QUANTITIES) => {
    const sel = defaultSelection(kind, ctx.catalogue);
    return buildSnapshot(sel, q, priceSelection(sel, q, ctx), { discountPercent: 0, method: "unit", estimated: false, vatPercent: 15, catalogue: ctx.catalogue });
  };

  it("#1 nothing with quantity 0 reaches the purchase list (partitions + light troughs, no ceilings)", () => {
    const s = snapOf("gypsum", { ...EMPTY_QUANTITIES, partitions: 40, troughM: 10 });
    expect(s.purchaseList.length).toBeGreaterThan(0);
    expect(s.purchaseList.filter((p) => !(p.qty > 0)).map((p) => p.key)).toEqual([]);
  });

  it("#6 rock-wool insulation and maintenance hatches are bought too — consumables / protection are not", () => {
    const q = { ...EMPTY_QUANTITIES, ceilNormal: 100, partitions: 40, hatches: { "60x60": 2 } };
    const sel = defaultSelection("gypsum", ctx.catalogue);
    const withInsulation = { ...sel, steps: { ...sel.steps, insulation: { ...sel.steps.insulation, on: true } } };
    const o = priceSelection(withInsulation, q, ctx);
    expect(o.result.lines.some((l) => l.key === "insulation")).toBe(true);
    const keys = buildSnapshot(withInsulation, q, o, { discountPercent: 0, method: "unit", estimated: false, vatPercent: 15, catalogue: ctx.catalogue }).purchaseList.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["insulation", "hatch_60x60"]));
    const paint = snapOf("interior", { ...EMPTY_QUANTITIES, walls: 100, ceilings: 50, colours: 1 });
    expect(paint.purchaseList.some((p) => p.key === "consumables" || p.key === "protection")).toBe(false);
  });

  it("#2 the priced table uses each pack size's own price (18 L @180, 4 L @50), volume split only as a fallback", () => {
    const src: QtySource = {
      items: [paint({ cost: 410 })],
      needs: [{ key: "ext_finish_لون 1", need: 37.5, needUnit: "L", perPack: null, packPrices: [{ size: 18, price: 180 }, { size: 4, price: 50 }] }],
    };
    const rows = materialRows(src, { prices: true });
    expect(rows.map((r) => [r.size, r.unitPrice, r.cost])).toEqual([[18, 180, 360], [4, 50, 50]]);
    // the quantities-only path never carries pack prices
    expect(needsFromLines([{ key: "x", group: "material", label: "x", need: 1, needUnit: "L", purchase: { kind: "packs", packs: [{ size: 18, count: 1, price: 180 }], volume: 18, leftover: 17 }, qty: 1, unit: "pack", unitPrice: 0, cost: 180, formula: "", inputs: {} }])[0]).not.toHaveProperty("packPrices");
  });

  it("#7 a product without a price is flagged in the priced table", () => {
    const rows = materialRows({ items: [paint({ cost: 0, packs: [{ size: 18, count: 2 }] })], needs: [{ key: "ext_finish_لون 1", need: 30, needUnit: "L", perPack: null }] }, { prices: true });
    expect(rows[0].unpriced).toBe(true);
    expect(materialRows(src0(), { prices: true })[0].unpriced).toBeFalsy();
    expect(materialRows(src0(), { prices: false })[0]).not.toHaveProperty("unpriced");
  });

  it("#8 the fallback brand «Generic» never shows in Arabic material names or the brand column", () => {
    const rows = materialRows({ items: [{ key: "primer", label: "أساس (برايمر) — Generic", brand: "Generic", colour: null, packs: [{ size: 18, count: 1 }], qty: 1, unit: "pack", leftover: 5, productId: "primer" }], needs: [] }, { prices: false });
    expect(rows[0].material).toBe("أساس (برايمر)");
    expect(rows[0].brand).toBeNull();
    const s = snapOf("interior", { ...EMPTY_QUANTITIES, walls: 100, ceilings: 50, colours: 1 });
    expect(JSON.stringify(s.lines)).not.toContain("Generic");
  });
});

const src0 = (): QtySource => ({ items: [paint({ packs: [{ size: 18, count: 1 }], cost: 180 })], needs: [] });
