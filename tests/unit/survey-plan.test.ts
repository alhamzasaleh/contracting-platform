import { describe, expect, it } from "vitest";
import {
  cleanPlanDraft,
  dimensionTokens,
  floorLabels,
  isFloorPlan,
  labelRegion,
  markRepeats,
  metresPerPoint,
  planRoomName,
  planScale,
  planTitle,
  tileGrid,
  PLAN_MAX_TILES,
  type PlanDraft,
  type PlanToken,
} from "@/lib/survey/plan";
import sheets from "./fixtures/plan-sheets.json";

/**
 * Floor plan → survey rooms (owner, Nov 2026). Fixture = labels, dimensions and English words of
 * three sheets of a real villa set (ground floor plan, first floor plan, finishes schedule) — no
 * client data. The owner measured the villa on site: 561 m² of rooms; the plan reading gave 567.
 */
type Sheet = { width: number; height: number; tokens: PlanToken[] };
const S = sheets as unknown as Record<string, Sheet>;
const text = (s: Sheet) => s.tokens.map((t) => t.s).join(" ");

describe("which sheets are floor plans", () => {
  it("ground and first floor plans yes; the finishes schedule (every floor's labels) no", () => {
    expect(isFloorPlan(text(S["8"]), S["8"].tokens)).toBe(true);
    expect(isFloorPlan(text(S["9"]), S["9"].tokens)).toBe(true);
    expect(isFloorPlan(text(S["23"]), S["23"].tokens)).toBe(false);
  });
  it("an electrical / HVAC sheet with the same room tags is not a floor plan", () => {
    const t = S["8"].tokens;
    expect(isFloorPlan(`${text(S["8"])} GROUND FLOOR LIGHTING PLAN`, t)).toBe(false);
    expect(isFloorPlan("FIRST FLOOR HVAC PLAN", t)).toBe(false);
  });
  it("labels: the dominant prefix only (sheet refs like A-07 / A-18 dropped)", () => {
    const f = floorLabels(S["8"].tokens)!;
    expect(f.prefix).toBe("GF");
    expect(f.labels.every((l) => l.s.startsWith("GF-"))).toBe(true);
    expect(new Set(f.labels.map((l) => l.s))).toContain("GF-07");
    expect(floorLabels(S["9"].tokens)!.prefix).toBe("F1");
  });
  it("scale and title", () => {
    expect(planScale(text(S["8"]))).toBe(100);
    expect(planScale("SCALE : 1:50 detail 1/50")).toBe(50);
    expect(planScale("no scale here")).toBe(100);
    expect(planTitle(text(S["8"]), "GF")).toBe("GROUND FLOOR PLAN");
    expect(planTitle("nothing", "F1")).toBe("F1");
  });
});

describe("cropping the drawing", () => {
  it("the region holds every label with ~7 m around, inside the page", () => {
    const s = S["8"];
    const f = floorLabels(s.tokens)!;
    const r = labelRegion(f.labels, 100, s);
    for (const l of f.labels) expect(l.x > r.x0 && l.x < r.x1 && l.y > r.y0 && l.y < r.y1).toBe(true);
    expect(r.x0).toBeGreaterThanOrEqual(0);
    expect(r.x1).toBeLessThanOrEqual(s.width);
    expect((f.labels[0].x - r.x0) * metresPerPoint(100)).toBeLessThan(40);
  });
  it("tiles cover the whole region, overlap, and never exceed the limit", () => {
    const region = { x0: 100, y0: 100, x1: 760, y1: 720 };
    const { zoom, tiles } = tileGrid(region, 3.5);
    expect(tiles.length).toBeLessThanOrEqual(PLAN_MAX_TILES);
    for (const t of tiles) expect((t.x1 - t.x0) * zoom).toBeLessThanOrEqual(1400.001);
    // every point of the region is in some tile
    for (let x = region.x0; x <= region.x1; x += 20)
      for (let y = region.y0; y <= region.y1; y += 20) expect(tiles.some((t) => x >= t.x0 - 1e-6 && x <= t.x1 + 1e-6 && y >= t.y0 - 1e-6 && y <= t.y1 + 1e-6)).toBe(true);
    // a huge sheet lowers the zoom instead of sending more tiles
    const big = tileGrid({ x0: 0, y0: 0, x1: 1684, y1: 1191 }, 3.5);
    expect(big.tiles.length).toBeLessThanOrEqual(PLAN_MAX_TILES);
    expect(big.zoom).toBeLessThan(3.5);
  });
  it("dimension tokens read 4.50 and .80, ignore tags and text", () => {
    const d = dimensionTokens([{ s: "4.50", x: 1, y: 1 }, { s: ".80", x: 2, y: 2 }, { s: "GF-07", x: 3, y: 3 }, { s: "+0.50M", x: 4, y: 4 }, { s: "2026", x: 5, y: 5 }]);
    expect(d.map((x) => x.v)).toEqual([4.5, 0.8]);
  });
});

describe("cleaning the AI's reading", () => {
  // metres from the region corner (as the browser sends them)
  const sheet = {
    labels: [{ s: "GF-07", x: 5, y: 5 }, { s: "GF-11", x: 15, y: 10 }],
    words: [{ s: "4.50", x: 5, y: 8 }, { s: "6.20", x: 3, y: 5 }, { s: "6.10", x: 14, y: 13 }],
  };
  const draft = (rooms: Partial<PlanDraft["rooms"][number]>[]): PlanDraft => ({
    floor_name: "الدور الأرضي",
    rooms: rooms.map((r) => ({ label: "GF-07", name: "مجلس", length_m: 6.2, width_m: 4.5, open_space: false, confidence: "high", note: null, ...r })),
    conflicts: [],
  });

  it("a closed room whose two sides are printed near its label is confirmed", () => {
    const r = cleanPlanDraft(draft([{}]), sheet, "GF").rooms[0];
    expect(r).toMatchObject({ label: "GF-07", length_m: 6.2, width_m: 4.5, confirmed: true, unit_label: "الدور الأرضي" });
  });
  it("a side not printed near the label, an open space, or an unknown label → not confirmed", () => {
    expect(cleanPlanDraft(draft([{ width_m: 4.3 }]), sheet, "GF").rooms[0].confirmed).toBe(false);
    expect(cleanPlanDraft(draft([{ label: "GF-11", length_m: 8.1, width_m: 6.1, open_space: true }]), sheet, "GF").rooms[0].confirmed).toBe(false);
    expect(cleanPlanDraft(draft([{ label: "GF-99" }]), sheet, "GF").rooms[0].confirmed).toBe(false);
  });
  it("length is the longer side; implausible numbers become empty", () => {
    const r = cleanPlanDraft(draft([{ length_m: 4.5, width_m: 6.2 }, { length_m: -1, width_m: 400 }]), sheet, "GF").rooms;
    expect([r[0].length_m, r[0].width_m]).toEqual([6.2, 4.5]);
    expect([r[1].length_m, r[1].width_m]).toEqual([null, null]);
  });
  it("an empty floor name falls back to the sheet's", () => {
    expect(cleanPlanDraft({ ...draft([]), floor_name: " " }, sheet, "GROUND FLOOR PLAN").floor).toBe("GROUND FLOOR PLAN");
  });
  it("a label read on two sheets is flagged on the second", () => {
    const [a, b] = markRepeats([[{ label: "GF-07" }, { label: "GF-03" }, { label: "GF-03" }], [{ label: "GF-07" }, { label: "F1-01" }]]);
    expect(a.map((r) => r.repeated)).toEqual([false, false, false]); // two rooms sharing a tag on one sheet (wash + toilet) are fine
    expect(b.map((r) => r.repeated)).toEqual([true, false]);
  });
  it("the saved name carries the tag once", () => {
    expect(planRoomName({ name: "مجلس", label: "GF-07" })).toBe("مجلس (GF-07)");
    expect(planRoomName({ name: "مجلس GF-07", label: "GF-07" })).toBe("مجلس GF-07");
  });
});

describe("label prefixes", () => {
  const tags = (list: string[]) => list.map((s, i) => ({ s, x: i, y: i }));
  it("a floor code beats many one-letter drawing refs", () => {
    const f = floorLabels(tags(["A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07", "GF-01", "GF-02", "GF-03"]))!;
    expect(f.prefix).toBe("GF");
  });
  it("two floors' tags together (a schedule) is not a floor plan; a few tags of the floor above are fine", () => {
    const sched = tags(["GF-01", "GF-02", "GF-03", "GF-04", "F1-01", "F1-02", "F1-03"]);
    expect(isFloorPlan("SCHEDULE OF FINISHES", sched)).toBe(false);
    expect(isFloorPlan("", sched)).toBe(false);
    expect(isFloorPlan("GROUND FLOOR PLAN", tags(["GF-01", "GF-02", "GF-03", "GF-04", "F1-01"]))).toBe(true);
  });
});

describe("sheets that only mention a few tags", () => {
  const tags = (list: string[]) => list.map((s, i) => ({ s, x: i, y: i }));
  it("a site plan with three drawing refs, or an elevation with four room tags, is not a floor plan", () => {
    expect(isFloorPlan("SITE DEVELOPMENT PLAN", tags(["A-01", "A-02", "A-03"]))).toBe(false);
    expect(isFloorPlan("ELEVATION STREET", tags(["GF-01", "GF-02", "GF-03", "GF-04"]))).toBe(false);
    expect(isFloorPlan("ROOF FLOOR PLAN", tags(["RF-01", "RF-02", "RF-03"]))).toBe(true);
  });
});

describe("review rows", () => {
  it("sizes typed with Arabic digits or a comma are read; out-of-range ones are empty", async () => {
    const { roomSize } = await import("@/lib/survey/plan");
    expect(roomSize("٤٫٥", 200)).toBe(4.5);
    expect(roomSize("4,5", 200)).toBe(4.5);
    expect(roomSize("6.20", 200)).toBe(6.2);
    expect(roomSize("35", 30)).toBeNull(); // a height the room form refuses
    expect(roomSize("0", 200)).toBeNull();
    expect(roomSize("abc", 200)).toBeNull();
  });
  it("a matching number printed by another room (far from the tag) doesn't make it «written on the plan»", () => {
    const sheet = { labels: [{ s: "GF-07", x: 5, y: 5 }], words: [{ s: "6.20", x: 3, y: 5 }, { s: "4.50", x: 5, y: 16 }] };
    const r = cleanPlanDraft({ floor_name: "x", conflicts: [], rooms: [{ label: "GF-07", name: "مجلس", length_m: 6.2, width_m: 4.5, open_space: false, confidence: "high", note: null }] }, sheet, "GF").rooms[0];
    expect(r.confirmed).toBe(false);
  });
});
