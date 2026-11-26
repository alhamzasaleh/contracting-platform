import { describe, expect, it } from "vitest";
import { ceilingLayout, gridLines } from "@/lib/engine/gypsum";
import { GYPSUM_CATALOGUE } from "@/lib/engine/defaults";

/**
 * Ceiling grid (owner, Nov 2026): the main C channels and the omegas are a square grid at the same
 * spacing (40 / 50 / 60 cm, agreed with the client); the edge angle carries the ceiling at the walls,
 * so the first channel / omega sits one spacing away from the wall — none against it. Each room's
 * channels run the way that costs less (bars + hangers).
 */
describe("gridLines", () => {
  it("lines strictly inside the room, one spacing from each wall", () => {
    expect(gridLines(4, 0.4)).toBe(9); // 0.4 … 3.6
    expect(gridLines(4, 0.5)).toBe(7); // 0.5 … 3.5
    expect(gridLines(4.1, 0.4)).toBe(10); // 0.4 … 4.0 (last 10 cm from the wall)
    expect(gridLines(3.6, 0.6)).toBe(5); // 0.6 … 3.0
    expect(gridLines(1.2, 0.6)).toBe(1);
  });
  it("a strip narrower than the spacing still gets one line", () => {
    expect(gridLines(0.35, 0.4)).toBe(1);
  });
});

describe("ceilingLayout", () => {
  const p = { cSpacing: 0.4, omegaSpacing: 0.4, hangerSpacing: 1, hangingHeight: 0.4, cutAllowance: 0.15, suspension: "rod" as const };
  it("channels across the short side cost less: fewer hangers", () => {
    const a = ceilingLayout({ L: 6, W: 3 }, p, GYPSUM_CATALOGUE);
    expect(a.cAlong).toBe("length"); // C runs 6 m long, spaced across the 3 m
    expect(a.channels).toBe(gridLines(3, 0.4));
    expect(a.omegas).toBe(gridLines(6, 0.4));
    expect(a.hangers).toBe(a.channels * (Math.ceil(6 / 1) + 1));
  });
  it("the same room turned round gives the same layout turned round", () => {
    const a = ceilingLayout({ L: 3, W: 6 }, p, GYPSUM_CATALOGUE);
    expect(a.cAlong).toBe("width");
    expect(a.channels).toBe(gridLines(3, 0.4));
  });
  it("the owner's choice wins over the cheaper one", () => {
    const a = ceilingLayout({ L: 6, W: 3, cAlong: "width" }, p, GYPSUM_CATALOGUE);
    expect(a.cAlong).toBe("width");
    expect(a.channels).toBe(gridLines(6, 0.4));
  });
});

describe("pricing — one grid spacing for C and omega (owner: square grid 40 / 50 / 60 cm)", () => {
  it("offers 40, 50 and 60 cm", async () => {
    const { PRESETS } = await import("@/lib/pricing");
    expect(PRESETS.grid).toEqual([0.4, 0.5, 0.6]);
  });
  it("a template saved with different C and omega spacings opens as one square grid (the omega spacing)", async () => {
    const { defaultSelection } = await import("@/lib/pricing");
    const { seededProducts, seededRates } = await import("./helpers/seed");
    const sel = defaultSelection("gypsum", { products: seededProducts(), rates: seededRates() }, { options: { cSpacing: 1, omegaSpacing: 0.5 } as never });
    expect(sel.options.cSpacing).toBe(0.5);
    expect(sel.options.omegaSpacing).toBe(0.5);
  });
  it("prices the C channels at the grid spacing even if an older selection carries another C spacing", async () => {
    const { defaultSelection, priceSelection, EMPTY_QUANTITIES } = await import("@/lib/pricing");
    const { seededProducts, seededRates } = await import("./helpers/seed");
    const c = { catalogue: { products: seededProducts(), rates: seededRates() }, external: [], crew: [], vatPercent: 0 };
    const base = defaultSelection("gypsum", c.catalogue);
    const q = { ...EMPTY_QUANTITIES, gypsumRooms: [{ id: "r", name: "r", L: 6, W: 3, boardType: "normal" as const }] };
    const a = priceSelection({ ...base, options: { ...base.options, cSpacing: 1, omegaSpacing: 0.4 } }, q, c);
    const b = priceSelection({ ...base, options: { ...base.options, cSpacing: 0.4, omegaSpacing: 0.4 } }, q, c);
    expect(a.result.lines.find((l) => l.key === "c_channel")?.qty).toBe(b.result.lines.find((l) => l.key === "c_channel")?.qty);
    expect((a.result as { layouts?: { channels: number }[] }).layouts?.[0].channels).toBe(gridLines(3, 0.4));
  });
});

describe("review fixes", () => {
  it("a saved selection keeps one grid: C spacing is stored as the omega spacing", async () => {
    const { selectionSchema } = await import("@/lib/pricing/schema");
    const { defaultSelection } = await import("@/lib/pricing");
    const { seededProducts, seededRates } = await import("./helpers/seed");
    const sel = defaultSelection("gypsum", { products: seededProducts(), rates: seededRates() });
    const out = selectionSchema.parse({ ...sel, steps: {}, options: { ...sel.options, cSpacing: 1, omegaSpacing: 0.5 } });
    expect(out.options.cSpacing).toBe(0.5);
  });
  it("a missing grid rate is reported once, and zero spacings fall back instead of breaking pricing", async () => {
    const { buildEngineConfig, computeGypsum, GYPSUM_PARAMS } = await import("@/lib/engine");
    const { seededProducts, seededRates } = await import("./helpers/seed");
    const empty = buildEngineConfig({ products: [], rates: {} });
    expect(empty.warnings.filter((w) => w.kind === "missing_rate" && w.key === "gypsum.omegaSpacing")).toHaveLength(1);
    const zero = buildEngineConfig({ products: seededProducts(), rates: { ...seededRates(), "gypsum.omegaSpacing": 0, "gypsum.hangerSpacing": 0, "gypsum.studSpacing": 0 } });
    expect(zero.gypsum.params.omegaSpacing).toBe(GYPSUM_PARAMS.omegaSpacing);
    expect(zero.gypsum.params.hangerSpacing).toBe(GYPSUM_PARAMS.hangerSpacing);
    expect(zero.gypsum.params.studSpacing).toBe(GYPSUM_PARAMS.studSpacing);
    expect(() => computeGypsum({ rooms: [{ id: "r", name: "r", L: 4, W: 3, boardType: "normal" }] }, zero.gypsum.catalogue, zero.gypsum.params)).not.toThrow();
  });
  it("the C line shows how each room was laid (how many rooms run each way)", async () => {
    const { computeGypsum, GYPSUM_CATALOGUE, GYPSUM_PARAMS } = await import("@/lib/engine");
    const r = computeGypsum({ rooms: [{ id: "a", name: "a", L: 6, W: 3, boardType: "normal" }, { id: "b", name: "b", L: 3, W: 6, boardType: "normal" }] }, GYPSUM_CATALOGUE, GYPSUM_PARAMS);
    const c = r.lines.find((l) => l.key === "c_channel")!;
    expect(c.inputs).toMatchObject({ grid: 0.4, roomsAlongLength: 1, roomsAlongWidth: 1 });
  });
});
