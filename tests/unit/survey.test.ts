import { describe, expect, it } from "vitest";
import { surveyGaps, surveyQuantities, type SurveyRoom } from "@/lib/survey";

const room = (o: Partial<SurveyRoom>): SurveyRoom => ({
  id: o.name ?? "r", name: "r", unit_label: null, length_m: 5, width_m: 4, height_m: 3, openings_m2: 0,
  gypsum_ceiling: false, ceiling_board: "normal", paint_walls: true, paint_ceiling: true, wall_zone: "normal", ...o,
});

const ROOMS = [
  room({ name: "مجلس", length_m: 10, width_m: 8, openings_m2: 6, gypsum_ceiling: true }),
  room({ name: "مطبخ", length_m: 5, width_m: 5, gypsum_ceiling: true, ceiling_board: "fire" }),
  room({ name: "حمام", length_m: 3, width_m: 2, height_m: 2.8, gypsum_ceiling: true, ceiling_board: "moisture", wall_zone: "wet" }),
  room({ name: "مخزن", length_m: 2, width_m: 2, paint_ceiling: false }),
];

describe("survey → quantities", () => {
  it("gypsum: ceiling areas per board type from rooms, with real dimensions", () => {
    const q = surveyQuantities("gypsum", "rooms", ROOMS, { partitions: 12 });
    expect([q.ceilNormal, q.ceilFire, q.ceilMoisture]).toEqual([80, 25, 6]);
    expect(q.partitions).toBe(12);
    expect(q.gypsumRooms?.map((r) => r.boardType)).toEqual(["normal", "fire", "moisture"]);
  });

  it("interior: walls = perimeter × height − openings; ceilings only where painted; zones", () => {
    const q = surveyQuantities("interior", "rooms", ROOMS, { colours: 2 });
    // 36×3−6=102 + 20×3=60 + 10×2.8=28 + 8×3=24
    expect(q.walls).toBe(214);
    expect(q.wet).toBe(28);
    expect(q.ceilings).toBe(80 + 25 + 6);
    expect(q.colours).toBe(2);
  });

  it("total mode uses the entered totals only", () => {
    const q = surveyQuantities("interior", "total", ROOMS, { walls: 500, ceilings: 200 });
    expect([q.walls, q.ceilings]).toEqual([500, 200]);
  });

  it("says what is missing", () => {
    expect(surveyGaps("exterior", surveyQuantities("exterior", "rooms", ROOMS, {}))).toEqual(["no_facade_area"]);
    expect(surveyGaps("interior", surveyQuantities("interior", "rooms", ROOMS, {}))).toEqual([]);
  });
});
