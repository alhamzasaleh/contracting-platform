import { describe, expect, it } from "vitest";
import { cleanFacade, materialsLegend, elevationTitles, elevationRegions, facadeArea, facadesTotal, frameLines, lineInventory, mergeFacades, missingSizes, type Facade } from "@/lib/survey/facade";

/**
 * Exterior paint from the elevation sheets (owner, Nov 2026): the architect's elevations give each
 * façade's parts (painted / stone / glass / GRC per the materials legend) and its openings; the paint
 * area is computed here — never by the AI — and every number is the owner's to review.
 * Fixture: the titles, level texts and sheet size of two real elevation sheets (no client data).
 */
const W = 1684, H = 1191;
const P11 = [
  { s: "MATERIALS OF ELEVATIONS LEGEND", x: 141, y: 81 },
  { s: "ROOF PARAPET LINE 12.30M", x: 334, y: 142 }, { s: "ROOF TOP 12.00M", x: 313, y: 161 }, { s: "ROOF FINISH 8.70M", x: 317, y: 254 },
  { s: "FIRST FLOOR FINISH 4.70M", x: 331, y: 367 }, { s: "GROUND FLOOR FINISH 0.50M", x: 327, y: 464 }, { s: "STREET LEVEL 00 CM", x: 324, y: 510 },
  { s: "EAST ELEVATION (E01)", x: 851, y: 588 },
  { s: "ROOF PARAPET LINE 12.30M", x: 334, y: 649 }, { s: "FIRST FLOOR FINISH 4.70M", x: 332, y: 873 }, { s: "STREET LEVEL 00 CM", x: 324, y: 1016 },
  { s: "WEST ELEVATION (E02)", x: 871, y: 1060 },
  { s: "ELEVATION", x: 1595, y: 514 }, { s: "ELEVATIONS", x: 1591, y: 781 }, { s: "NOTES:", x: 1500, y: 300 },
];
const P12 = [
  { s: "SOUTH ELEVATION (E03)", x: 848, y: 538 },
  { s: "NOURTH", x: 802, y: 1024 }, { s: "ELEVATION (E04)", x: 936, y: 1024 },
  { s: "ELEVATION DETAILS - (W.D1)", x: 608, y: 1050 },
];

describe("finding the elevations on a sheet", () => {
  it("reads each titled elevation with its direction (also when the direction is a separate word, typos included)", () => {
    expect(elevationTitles(P11).map((e) => [e.code, e.dir])).toEqual([["E01", "east"], ["E02", "west"]]);
    expect(elevationTitles(P12).map((e) => [e.code, e.dir])).toEqual([["E03", "south"], ["E04", "north"]]);
  });
  it("skips legends, title-block words and detail sheets", () => {
    expect(elevationTitles([{ s: "ELEVATION DETAILS - (W.D1)", x: 1, y: 1 }, { s: "ELEVATIONS", x: 1, y: 1 }, { s: "FLOOR ELEVATION", x: 1, y: 1 }])).toEqual([]);
  });
  it("each elevation's drawing is the band above its title, left of the title block, with its level texts", () => {
    const [east, west] = elevationRegions(P11, { width: W, height: H });
    expect(east.code).toBe("E01");
    expect(east.region.y1).toBeGreaterThan(588);
    expect(east.region.y0).toBeLessThan(142);
    expect(east.region.x0).toBeLessThan(313);
    expect(east.region.x1).toBeLessThan(1500);
    // the west band starts below the east title
    expect(west.region.y0).toBeGreaterThan(588);
    expect(west.region.y1).toBeGreaterThan(1060);
  });
  it("the right edge is the drawing frame (a sheet-tall line), not the title block", () => {
    // the real sheet: frame at x 38 / 42 and 1468 / 1472, title-block inner line at 1513
    // + 40 short hatch strokes stacked on x = 1050 (together taller than the page): not a frame
    const hatch = Array.from({ length: 40 }, (_, i) => [1050, i * 30, 1050, i * 30 + 25]);
    const segs = [[42, 30, 42, 1160], [1468, 30, 1468, 1160], [1513, 30, 1513, 1160], [900, 200, 900, 400], ...hatch];
    expect(frameLines(segs, { height: H })).toEqual([42, 1467, 1512]);
    const [east] = elevationRegions(P11, { width: W, height: H }, frameLines(segs, { height: H }));
    expect(east.region.x1).toBe(1463);
  });
});

describe("the lines of the drawing (exact positions for measuring)", () => {
  it("keeps long horizontal / vertical lines inside the region, in metres from its corner, longest first", () => {
    const mpp = 0.0352777; // 1:100
    const region = { x0: 100, y0: 100, x1: 500, y1: 400 };
    const inv = lineInventory(
      [
        [200, 120, 200, 380], // vertical, 9.17 m
        [200.2, 130, 200.2, 200], // same x (merged)
        [450, 300, 450, 305], // too short
        [150, 350, 480, 350], // horizontal, 11.6 m
        [600, 120, 600, 380], // outside
        [210, 150, 260, 190], // diagonal
      ],
      region,
      mpp,
    );
    expect(inv.vertical[0].at).toBeCloseTo(3.53, 2);
    expect(inv.vertical).toHaveLength(1);
    expect(inv.horizontal[0].at).toBeCloseTo(8.82, 2);
    expect(inv.horizontal[0].from).toBeCloseTo(1.76, 2);
  });
});

const east: Facade = {
  code: "E01", dir: "east", include: true, notes: [],
  parts: [
    { id: "p1", name: "الدور الأرضي والأول", material: "paint", width_m: 12, height_m: 8.2, count: 1, include: true },
    { id: "p2", name: "تكسية حجر", material: "stone", width_m: 3, height_m: 8.2, count: 1, include: true },
    { id: "p3", name: "زجاج", material: "glass", width_m: 2, height_m: 3, count: 1, include: true },
    { id: "p4", name: "السور", material: "paint", width_m: 10, height_m: 2.7, count: 1, include: false },
  ],
  openings: [
    { id: "o1", part: "p1", kind: "window", width_m: 1.5, height_m: 2, count: 4 },
    { id: "o2", part: "p1", kind: "door", width_m: 1, height_m: 2.4, count: 1 },
    // the fence gate: only subtracted while the fence is counted
    { id: "o3", part: "p4", kind: "door", width_m: 4, height_m: 2.5, count: 1 },
  ],
};

describe("paint area of a façade", () => {
  it("= painted parts − the openings in them; stone / glass / GRC listed apart; an uncounted part (the fence) and its gate left out", () => {
    const a = facadeArea(east);
    expect(a.gross).toBe(98.4);
    expect(a.openings).toBe(14.4);
    expect(a.paint).toBe(84);
    expect(a.other).toEqual({ stone: 24.6, glass: 6, grc: 0, other: 0 });
  });
  it("counting the fence adds its wall and subtracts its gate", () => {
    const withFence = { ...east, parts: east.parts.map((p) => (p.id === "p4" ? { ...p, include: true } : p)) };
    expect(facadeArea(withFence).paint).toBe(84 + 27 - 10);
  });
  it("openings of a part that isn't painted (changed to stone) aren't subtracted; an opening with no part is (taken as painted)", () => {
    const stone = { ...east, parts: east.parts.map((p) => (p.id === "p1" ? { ...p, material: "stone" as const } : p)) };
    expect(facadeArea(stone).openings).toBe(0);
    const loose = { ...east, openings: [{ id: "x", part: null, kind: "window" as const, width_m: 1, height_m: 1, count: 2 }] };
    expect(facadeArea(loose).paint).toBe(98.4 - 2);
  });
  it("never below zero; the survey total = the included façades", () => {
    expect(facadeArea({ ...east, openings: [{ id: "o", part: "p1", kind: "window", width_m: 50, height_m: 10, count: 1 }] }).paint).toBe(0);
    expect(facadesTotal([east, { ...east, code: "E02", include: false }])).toBe(84);
  });
  it("counts the rows of counted parts / openings still missing a size (said before approving)", () => {
    const gaps = { ...east, parts: [...east.parts, { id: "p5", name: "x", material: "paint" as const, width_m: null, height_m: 3, count: 1, include: true }], openings: [...east.openings, { id: "o9", part: "p1", kind: "window" as const, width_m: 1, height_m: null, count: 1 }] };
    expect(missingSizes([gaps, { ...gaps, code: "E02", include: false }])).toBe(2);
  });
});

describe("a new reading joins the approved façades", () => {
  it("replaces the same code, keeps the others", () => {
    const west = { ...east, code: "E02", dir: "west" as const };
    const newEast = { ...east, parts: [] };
    expect(mergeFacades([east, west], [newEast]).map((f) => [f.code, f.parts.length])).toEqual([["E01", 0], ["E02", 4]]);
    expect(mergeFacades(null, [west]).map((f) => f.code)).toEqual(["E02"]);
  });
});

describe("cleaning the AI's draft", () => {
  it("keeps plausible sizes only, whole counts, gives rows ids and links openings to their part", () => {
    const f = cleanFacade({
      code: "E01", direction: "east",
      parts: [
        { name: "واجهة", material: "paint", width_m: 12.004, height_m: 8.2, count: 1, fence: false },
        { name: "خطأ", material: "paint", width_m: 900, height_m: 3, count: 1, fence: false },
        { name: "السور", material: "paint", width_m: 10, height_m: 2.7, count: 1, fence: true },
      ],
      openings: [{ kind: "window", width_m: 1.5, height_m: 2, count: 2.6, part: 0 }, { kind: "door", width_m: 4, height_m: 2.5, count: 1, part: 2 }, { kind: "window", width_m: 1, height_m: 1, count: 1, part: 9 }],
      notes: ["x"],
    });
    expect(f.dir).toBe("east");
    expect(f.parts[0].width_m).toBe(12);
    expect(f.parts[1].width_m).toBeNull();
    expect(f.parts[2].include).toBe(false);
    expect(new Set([...f.parts, ...f.openings].map((r) => r.id)).size).toBe(6);
    expect(f.openings.map((o) => o.part)).toEqual([f.parts[0].id, f.parts[2].id, null]);
    expect(f.openings[0].count).toBe(3);
    expect(f.notes).toEqual(["x"]);
  });
});

describe("the materials legend", () => {
  it("one line per material: number and name (the real sheet's legend)", () => {
    const tokens = [
      { s: "1", x: 134, y: 149 }, { s: "3", x: 134, y: 216 }, { s: "2", x: 135, y: 183 }, { s: "MATERIALS OF ELEVATIONS LEGEND", x: 141, y: 81 },
      { s: "SYMBOL", x: 94, y: 111 }, { s: "CODE", x: 132, y: 111 }, { s: "ITEM NAME", x: 195, y: 110 }, { s: "4", x: 135, y: 250 },
      { s: "STONE", x: 185, y: 183 }, { s: "WHITE PAINT", x: 196, y: 146 }, { s: "GLASS", x: 181, y: 215 }, { s: "GRC", x: 182, y: 252 },
    ];
    expect(materialsLegend(tokens)).toEqual(["1 WHITE PAINT", "2 STONE", "3 GLASS", "4 GRC"]);
    expect(materialsLegend([{ s: "x", x: 1, y: 1 }])).toEqual([]);
  });
});
