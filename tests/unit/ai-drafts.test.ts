import { describe, expect, it } from "vitest";
import { cleanDraft } from "@/lib/survey/ai-draft";

const room = (o: Partial<Parameters<typeof cleanDraft>[0]["rooms"][number]>) => ({
  name: "غرفة", unit_label: null, length_m: 4, width_m: 3, height_m: 3, openings_m2: null, gypsum_ceiling: false,
  ceiling_board: "normal" as const, wall_zone: "normal" as const, paint_walls: true, paint_ceiling: true, ...o,
});
const totals = { walls: null, ceilings: null, facade: null, partitions: null, troughM: null, shadowM: null, crackM: null, colours: null };

describe("AI survey draft cleaning", () => {
  it("keeps plausible numbers, fills the usual height and lists what's missing", () => {
    const d = cleanDraft(
      { rooms: [room({ name: " المجلس ", height_m: null }), room({ length_m: -2, width_m: 500 }), room({ name: "" })], totals: { ...totals, troughM: 12, walls: -5 }, unclear: ["x"] },
      3.2,
    );
    expect(d.rooms[0]).toMatchObject({ name: "المجلس", height_m: 3.2, missing: ["height"] });
    expect(d.rooms[1]).toMatchObject({ length_m: null, width_m: null, missing: ["length", "width"] });
    expect(d.rooms[2].name).toBe("غرفة 3");
    expect(d.totals).toEqual({ troughM: 12 });
  });
});

describe("suggestions from past quotes", async () => {
  const { pastStats } = await import("@/lib/pricing/history");
  it("suggests the median winning margin (never below the minimum) and typical prices", () => {
    const wt = (p: number) => [{ workType: "walls", pricePerM2: p }];
    const s = pastStats(
      [
        { outcome: "won", margin: 24, workTypes: wt(30), plannedDays: 10, actualDays: 12 },
        { outcome: "won", margin: 27.3, workTypes: wt(32), plannedDays: 10, actualDays: 11 },
        { outcome: "won", margin: 26, workTypes: wt(34) },
        { outcome: "lost", margin: 33, workTypes: wt(40) },
      ],
      20,
    );
    expect(s).toMatchObject({ won: 3, lost: 1, winRate: 75, wonMargin: 26, lostMargin: 33, suggestedMargin: 26, durationFactor: 1.15 });
    expect(s.pricePerM2).toEqual([{ workType: "walls", median: 32, count: 3 }]);
    expect(pastStats([{ outcome: "won", margin: 12, workTypes: [] }, { outcome: "won", margin: 14, workTypes: [] }, { outcome: "won", margin: 13, workTypes: [] }], 20).suggestedMargin).toBe(20);
    expect(pastStats([{ outcome: "won", margin: 30, workTypes: [] }], 20).suggestedMargin).toBeNull();
  });
});

describe("datasheet draft cleaning", async () => {
  const { cleanDatasheet } = await import("@/lib/catalogue/datasheet");
  it("drops impossible coverage, sorts packs and rounds coats", () => {
    const d = cleanDatasheet({ product_name: "x", brand: "Jotun", category: "finish_paint", unit: "L", coverage_m2_per_unit: 120, coverage_text: null, pack_sizes: [4, 18, 18, -1], recommended_coats: 2.2, drying_time: null, use: "interior", notes: [], unclear: [] });
    expect(d.coverage_m2_per_unit).toBeNull();
    expect(d.flags).toEqual(["coverage"]);
    expect(d.pack_sizes).toEqual([18, 4]);
    expect(d.recommended_coats).toBe(2);
  });
});

describe("calibration (A.8)", async () => {
  const { calibrate, suggestedCoverage } = await import("@/lib/calibration");
  it("flags a product used consistently more than planned, and only then", () => {
    const proj = (c: string, actual: number, primer?: number) => ({
      contract: c,
      planned: [{ productId: "paint", label: "دهان", qty: 10, unitPrice: 100 }, { productId: "primer", label: "أساس", qty: 2, unitPrice: 120 }],
      actual: { paint: actual, ...(primer != null ? { primer } : {}) },
    });
    const rows = calibrate([proj("C-1", 1150, 240), proj("C-2", 1120, 250), proj("C-3", 1200, 200)]);
    const paint = rows.find((r) => r.productId === "paint")!;
    expect(paint).toMatchObject({ consistent: true, variance: 0.15 });
    expect(paint.projects.map((p) => p.actual)).toEqual([11.5, 11.2, 12]);
    // primer goes both ways → not consistent
    expect(rows.find((r) => r.productId === "primer")!.consistent).toBe(false);
    // two projects are not enough
    expect(calibrate([proj("C-1", 1500), proj("C-2", 1500)])[0].consistent).toBe(false);
    expect(suggestedCoverage(6.67, 0.15)).toBe(5.8);
  });
});
