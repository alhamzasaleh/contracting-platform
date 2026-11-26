import { describe, expect, it } from "vitest";
import { computeGypsum, cutPlan, cutToBars, framingRuns, GYPSUM_CATALOGUE, GYPSUM_PARAMS, hangerCut, hangerPositions, linePositions } from "@/lib/engine";

const ROOMS = (
  [[10, 8, "normal"], [10, 10, "normal"], [5, 5, "normal"], [5, 5, "normal"], [5, 5, "normal"], [5, 5, "normal"], [13, 5, "normal"], [5, 5, "fire"], [5, 3, "moisture"], [5, 3, "moisture"]] as const
).map(([L, W, b], i) => ({ id: `r${i}`, name: `غرفة ${i + 1}`, L, W, boardType: b }));
const villa = computeGypsum({ rooms: ROOMS, troughM: 60 }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
const qty = (k: string) => villa.lines.find((l) => l.key === k)!.qty;

describe("framing document (owner, Nov 2026)", () => {
  it("is frozen with the result for measured rooms only", () => {
    expect(villa.framing?.rooms).toHaveLength(10);
    expect(villa.framing).toMatchObject({ grid: 0.4, troughOmega: 120, troughHangers: 60, bars: { c: 3, omega: 3, angle: 3, hanger: 3 } });
    expect(computeGypsum({ quickAreas: { normal: 100 } }, GYPSUM_CATALOGUE, GYPSUM_PARAMS).framing).toBeUndefined();
  });

  it("puts lines one spacing apart, the first one spacing from the wall", () => {
    expect(linePositions(3, 0.4)).toEqual([0.4, 0.8, 1.2, 1.6, 2, 2.4, 2.8]);
    expect(linePositions(1.2, 0.6)).toEqual([0.6]);
    expect(linePositions(0.35, 0.4)).toEqual([0.175]);
    expect(linePositions(0, 0.4)).toEqual([]);
  });

  it("puts hangers inside the channel only, one spacing apart, as many as the engine counts", () => {
    // none at the channel ends: the edge angle carries them (owner, Nov 2026)
    expect(hangerPositions(5, 1)).toEqual([1, 2, 3, 4]);
    expect(hangerPositions(4.5, 1)).toEqual([1, 2, 3, 4]);
    expect(hangerPositions(0.8, 1)).toEqual([0.4]);
  });

  it("cuts exactly the bars of the bill of quantities, and says which room each piece is for", () => {
    const f = villa.framing!;
    const runs = framingRuns(f, "trough");
    for (const [k, list, stock] of [["c_channel", runs.c, f.bars.c], ["omega", runs.omega, f.bars.omega], ["edge_angle", runs.angle, f.bars.angle]] as const) {
      const plan = cutPlan(list, stock);
      expect(plan.bars).toBe(qty(k));
      expect(plan.bars).toBe(cutToBars(list.map((p) => p.length), stock).bars);
      expect(plan.patterns.reduce((s, p) => s + p.count, 0)).toBe(plan.bars);
      // every metre is accounted for
      const cut = plan.patterns.reduce((s, p) => s + p.count * p.pieces.reduce((a, x) => a + x.length, 0), 0);
      expect(cut).toBeCloseTo(list.reduce((s, p) => s + p.length, 0), 6);
      for (const p of plan.patterns) expect(p.pieces.reduce((a, x) => a + x.length, 0) + p.offcut).toBeCloseTo(stock, 6);
    }
  });

  it("groups identical bars («× 55: 2 m room A + 1 m room B»)", () => {
    const plan = cutPlan([{ length: 5, label: "A" }, { length: 5, label: "A" }, { length: 4, label: "B" }], 3);
    expect(plan.bars).toBe(5); // 3 whole (A 2, B 1) + rests 2, 2, 1 → [2+1], [2]
    expect(plan.patterns).toEqual([
      { count: 2, pieces: [{ length: 3, label: "A" }], offcut: 0, full: true },
      { count: 1, pieces: [{ length: 3, label: "B" }], offcut: 0, full: true },
      { count: 1, pieces: [{ length: 2, label: "A" }, { length: 1, label: "B" }], offcut: 0, full: false },
      { count: 1, pieces: [{ length: 2, label: "A" }], offcut: 1, full: false },
    ]);
  });

  it("hanger pieces: as many rods as the bill of quantities", () => {
    const h = hangerCut(villa.framing!);
    expect(h).toMatchObject({ piece: 0.55, total: 860, perBar: 5, bars: qty("rod"), offcut: 0.25 });
  });
});

describe("survey → pricing → frozen version", () => {
  it("the room's chosen direction reaches the engine; automatic leaves it to the engine", async () => {
    const { surveyQuantities } = await import("@/lib/survey");
    const base = { unit_label: null, height_m: 3, openings_m2: 0, gypsum_ceiling: true, ceiling_board: "normal" as const, paint_walls: false, paint_ceiling: false, wall_zone: "normal" as const };
    const q = surveyQuantities("gypsum", "rooms", [{ ...base, id: "a", name: "a", length_m: 6, width_m: 3, c_along: "width" }, { ...base, id: "b", name: "b", length_m: 6, width_m: 3, c_along: null }], {});
    expect(q.gypsumRooms).toEqual([
      { id: "a", name: "a", L: 6, W: 3, boardType: "normal", cAlong: "width" },
      { id: "b", name: "b", L: 6, W: 3, boardType: "normal" },
    ]);
  });
  it("a saved version keeps the framing and each room's direction, so re-pricing it lays the same metal", async () => {
    const { defaultSelection, priceSelection, freezeFraming, EMPTY_QUANTITIES } = await import("@/lib/pricing");
    const { seededProducts, seededRates } = await import("./helpers/seed");
    const c = { catalogue: { products: seededProducts(), rates: seededRates() }, external: [], crew: [], vatPercent: 0 };
    const sel = defaultSelection("gypsum", c.catalogue);
    const q = { ...EMPTY_QUANTITIES, gypsumRooms: [{ id: "a", name: "a", L: 6, W: 3, boardType: "normal" as const }] };
    const out = priceSelection(sel, q, c);
    const frozen = freezeFraming(q, out);
    expect(frozen.framing?.rooms[0]).toMatchObject({ id: "a", cAlong: "width" }); // 6 × 3: across is cheaper (fewer hangers)
    expect(frozen.gypsumRooms?.[0].cAlong).toBe("width");
    expect(q.gypsumRooms[0]).not.toHaveProperty("cAlong"); // the input is not changed
    expect(freezeFraming({ ...EMPTY_QUANTITIES, walls: 10 }, priceSelection(defaultSelection("interior", c.catalogue), { ...EMPTY_QUANTITIES, walls: 10 }, c)).framing).toBeUndefined();
  });
});

describe("framing PDF", () => {
  it("only the framing pages of quotes and contracts", async () => {
    const { STAFF_DOCS, pdfDocName } = await import("@/lib/pdf-docs");
    for (const ok of ["quotations/Q-2026-001/framing", "contracts/C-2026-003/framing"]) expect(STAFF_DOCS.test(ok)).toBe(true);
    for (const bad of ["invoices/INV-2026-001/framing", "quotations/Q-2026-001/framing/priced", "contracts/C-2026-003/framing/", "quotations/Q-2026-001/framingx"]) expect(STAFF_DOCS.test(bad)).toBe(false);
    expect(pdfDocName("contracts/C-2026-003/framing")).toBe("C-2026-003-framing");
  });
});

describe("review fixes (framing)", () => {
  it("cuts with exact lengths like cutToBars (no rounding before packing)", () => {
    const runs = [{ length: 3.83, label: "a" }, { length: 28.5703, label: "trough" }];
    expect(cutPlan(runs, 3.6).bars).toBe(cutToBars(runs.map((r) => r.length), 3.6).bars);
  });
  it("random runs: the plan always needs exactly cutToBars' bars", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 300; k++) {
      const stock = [3, 3.6, 4][k % 3];
      const runs = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ length: Math.round(rnd() * 120000) / 10000, label: `r${i % 3}` }));
      expect(cutPlan(runs, stock).bars).toBe(cutToBars(runs.map((r) => r.length), stock).bars);
    }
  });
  it("a hanger piece longer than the bar is said so (no «1 per bar, no offcut»)", () => {
    const f = { ...villa.framing!, hangingHeight: 3, cutAllowance: 0.15, bars: { ...villa.framing!.bars, hanger: 3 } };
    expect(hangerCut(f)).toMatchObject({ piece: 3.15, perBar: 0, longer: true });
  });
  it("rooms carry their floor, so two «bedroom 1» on two floors stay apart", async () => {
    const { surveyQuantities } = await import("@/lib/survey");
    const base = { height_m: 3, openings_m2: 0, gypsum_ceiling: true, ceiling_board: "normal" as const, paint_walls: false, paint_ceiling: false, wall_zone: "normal" as const };
    const q = surveyQuantities("gypsum", "rooms", [{ ...base, id: "a", name: "نوم 1", unit_label: "الأرضي", length_m: 4, width_m: 3 }, { ...base, id: "b", name: "نوم 1", unit_label: "الأول", length_m: 4, width_m: 3 }], {});
    const r = computeGypsum({ rooms: q.gypsumRooms! }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(r.framing!.rooms.map((x) => x.unit)).toEqual(["الأرضي", "الأول"]);
    const labels = new Set(framingRuns(r.framing!, "t").c.map((p) => p.label));
    expect(labels.size).toBe(2);
  });
  it("says which metal is not in the bill of quantities (supplied by the client / labour only)", () => {
    const labourOnly = computeGypsum({ rooms: ROOMS, executeOnly: true }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(labourOnly.framing!.listed).toEqual({ c: false, omega: false, angle: false, hanger: false });
    expect(villa.framing!.listed).toEqual({ c: true, omega: true, angle: true, hanger: true });
    const noAngle = computeGypsum({ rooms: ROOMS, scope: { edge_angle: false } }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    expect(noAngle.framing!.listed.angle).toBe(false);
  });
});

describe("hangers inside the channel (review)", () => {
  it("new framings say they use the inside rule; the plan of an older one keeps its own hanger count", async () => {
    const { roomHangerPositions } = await import("@/lib/engine");
    expect(villa.framing!.hangerRule).toBe("inside");
    const room = villa.framing!.rooms.find((r) => r.L === 5 && r.W === 5)!;
    expect(roomHangerPositions(room, villa.framing!)).toEqual([1, 2, 3, 4]);
    // saved before the rule: 6 per channel on 5 m, ends included
    const old = { ...villa.framing!, hangerRule: undefined };
    expect(roomHangerPositions({ ...room, hangers: room.channels * 6 }, old)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("total-area estimate leaves out the hangers at the channel ends, near the measured count", () => {
    const quick = computeGypsum({ quickAreas: { normal: 400 } }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    // 400 ÷ (0.4 × 1) = 1000, minus the edge strip: estimated perimeter 280 ÷ 2 × (1/0.4 + 1/1) ÷ 2 = 245
    expect(quick.lines.find((l) => l.key === "rod")!.inputs.hangers).toBe(755);
  });
  it("the hanger lines say the hanger spacing and the trough share", () => {
    const rod = villa.lines.find((l) => l.key === "rod")!;
    expect(rod.inputs).toMatchObject({ hangers: 860, hangerSpacing: 1, troughHangers: 60 });
  });
});
