import { describe, expect, it } from "vitest";
import { defaultSelection, EMPTY_QUANTITIES, priceSelection, type PricingContext } from "@/lib/pricing";
import { buildSnapshot, readiness } from "@/lib/quotes";
import { seededProducts, seededRates } from "./helpers/seed";

const ctx: PricingContext = { catalogue: { products: seededProducts(), rates: seededRates() }, external: [], crew: [], vatPercent: 15 };
const q = { ...EMPTY_QUANTITIES, walls: 600, ceilings: 250, wet: 40, decorative: 30, colours: 2 };
const sel = defaultSelection("interior", ctx.catalogue);
const o = priceSelection(sel, q, ctx);
const snap = (discount = 0) => buildSnapshot(sel, q, o, { discountPercent: discount, method: "unit", estimated: false, vatPercent: 15, catalogue: ctx.catalogue });

describe("quote snapshot", () => {
  it("freezes price per m² per work type, totals with VAT after discount", () => {
    const s = snap(10); // 10 % discount
    expect(s.clientView.workTypes.map((w) => w.workType)).toEqual(["walls", "ceilings"]);
    expect(s.clientView.discountPercent).toBe(10);
    expect(s.clientView.discount).toBeCloseTo(s.clientView.subtotal * 0.1, 2);
    expect(s.clientView.net).toBeCloseTo(s.clientView.subtotal * 0.9, 2);
    expect(s.clientView.vat).toBeCloseTo(s.clientView.net * 0.15, 2);
    expect(s.clientView.total).toBeCloseTo(s.clientView.net * 1.15, 2);
  });

  it("lists included and not-included steps", () => {
    const s = snap();
    expect(s.clientView.included.map((i) => i.step)).toEqual(expect.arrayContaining(["putty", "primer", "wall_finish"]));
    expect(s.clientView.excluded).toContain("sealer");
  });

  it("builds a purchase list per product and colour with packs", () => {
    const s = snap();
    const finish = s.purchaseList.filter((p) => p.key.startsWith("wall_finish"));
    expect(finish).toHaveLength(2);
    expect(finish[0].packs[0]).toMatchObject({ size: 18 });
    expect(s.purchaseList.some((p) => p.key === "consumables")).toBe(false);
  });

  it("asks for approval below the minimum margin or with a discount", () => {
    expect(readiness(o, snap(), 20, []).approvals).toEqual([]);
    expect(readiness(o, snap(), 40, []).approvals).toEqual(["quote_margin"]);
    expect(readiness(o, snap(5), 20, []).approvals).toContain("quote_discount");
    expect(readiness(o, snap(), 20, ["no_paint_area"]).blocking).toEqual(["no_area"]);
  });
});

describe("features belong to gypsum", () => {
  it("a paint quote never lists troughs or hatches", () => {
    const qq = { ...q, troughM: 30, hatches: { "40x40": 2 } };
    const s = buildSnapshot(sel, qq, priceSelection(sel, qq, ctx), { discountPercent: 0, method: "unit", estimated: false, vatPercent: 0, catalogue: ctx.catalogue });
    expect(s.clientView.features).toEqual({ troughM: 0, shadowM: 0, hatches: {} });
  });
});
