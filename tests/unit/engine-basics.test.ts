import { describe, expect, it } from "vitest";
import { ceilTo, cutIdentical, cutToBars, optimisePacks } from "@/lib/engine";

describe("pack optimisation", () => {
  it("prefers 4×18 L + 3×4 L over 5×18 L when cheaper", () => {
    const r = optimisePacks(83.475, [
      { size: 18, price: 180 },
      { size: 4, price: 45 },
    ]);
    expect(r.cost).toBe(855);
    expect(r.packs).toEqual([
      { size: 18, count: 4, price: 180 },
      { size: 4, count: 3, price: 45 },
    ]);
    expect(r.leftover).toBeCloseTo(0.525, 3);
  });

  it("uses a single big pack when that is cheapest", () => {
    const r = optimisePacks(15, [
      { size: 18, price: 100 },
      { size: 4, price: 45 },
    ]);
    expect(r.packs).toEqual([{ size: 18, count: 1, price: 100 }]);
  });

  it("returns nothing for zero need", () => {
    expect(optimisePacks(0, [{ size: 18, price: 1 }]).packs).toEqual([]);
  });
});

describe("cut optimisation (first-fit-decreasing)", () => {
  it("fits 0.55 m rod pieces 5 per 3 m rod", () => {
    const r = cutIdentical(592, 0.55, 3);
    expect(r.bars).toBe(119);
  });

  it("reuses offcuts across runs and splits long runs", () => {
    // 13.333 m run ×2 on 3 m bars: 4 full bars each + two 1.333 m pieces in one bar
    const r = cutToBars([40 / 3, 40 / 3], 3);
    expect(r.bars).toBe(9);
    expect(r.offcuts).toEqual([0.333]);
  });

  it("puts a 2 m and a 1 m piece in one 3 m bar", () => {
    expect(cutToBars([2, 1, 2, 1], 3).bars).toBe(2);
  });
});

describe("price rounding", () => {
  it("rounds up to the step", () => {
    expect(ceilTo(33.127, 1)).toBe(34);
    expect(ceilTo(33.127, 0.5)).toBe(33.5);
    expect(ceilTo(33.127, 0.25)).toBe(33.25);
    expect(ceilTo(33.12, 0.01)).toBe(33.12);
    expect(ceilTo(34, 1)).toBe(34);
  });
});
