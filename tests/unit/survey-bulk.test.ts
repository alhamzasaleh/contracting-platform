import { describe, expect, it } from "vitest";
import { bulkRoomsSchema, bulkTargets } from "@/lib/survey/schema";

/** «تطبيق على عدة غرف» (owner, Nov 2026): set services for many rooms at once, then fix the exceptions. */
const S = "00000000-0000-4000-8000-000000000001";
const R = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("bulkRoomsSchema", () => {
  it("accepts rooms + any subset of settings", () => {
    const ok = bulkRoomsSchema.safeParse({ survey_id: S, ids: [R(1), R(2)], patch: { gypsum_ceiling: true, ceiling_board: "moisture" } });
    expect(ok.success).toBe(true);
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: [R(1)], patch: { height_m: "3.2" } }).success).toBe(true);
  });
  it("refuses no rooms, no change, unknown fields and out-of-range heights", () => {
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: [], patch: { paint_walls: true } }).success).toBe(false);
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: [R(1)], patch: {} }).success).toBe(false);
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: [R(1)], patch: { name: "x" } }).success).toBe(false);
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: [R(1)], patch: { height_m: "40" } }).success).toBe(false);
    expect(bulkRoomsSchema.safeParse({ survey_id: S, ids: Array.from({ length: 301 }, (_, i) => R(i + 1)), patch: { paint_walls: true } }).success).toBe(false);
  });
});

describe("bulkTargets", () => {
  const rooms = [
    { id: "a", unit_label: "الدور الأرضي" },
    { id: "b", unit_label: "الدور الأرضي" },
    { id: "c", unit_label: "الدور الأول" },
    { id: "d", unit_label: null },
  ];
  it("all rooms, one floor (rooms without a floor are their own group), or the ticked ones", () => {
    expect(bulkTargets(rooms, { kind: "all" })).toEqual(["a", "b", "c", "d"]);
    expect(bulkTargets(rooms, { kind: "floor", floor: "الدور الأرضي" })).toEqual(["a", "b"]);
    expect(bulkTargets(rooms, { kind: "floor", floor: null })).toEqual(["d"]);
    expect(bulkTargets(rooms, { kind: "pick", ids: ["c", "zz"] })).toEqual(["c"]);
  });
});

describe("bulkPatch", () => {
  it("never sends a hidden choice: board only while gypsum isn't «no», wall zone only while wall paint isn't «no»", async () => {
    const { bulkPatch } = await import("@/lib/survey/schema");
    const base = { gypsum: "keep", board: "keep", walls: "keep", zone: "keep", ceiling: "keep", height: null } as const;
    // gypsum off also clears the C direction (as the room dialog does), so switching it on again starts automatic
    expect(bulkPatch({ ...base, gypsum: "no", board: "fire", dir: "width" })).toEqual({ gypsum_ceiling: false, c_along: null });
    expect(bulkPatch({ ...base, walls: "no", zone: "wet" })).toEqual({ paint_walls: false });
    expect(bulkPatch({ ...base, gypsum: "yes", board: "moisture", height: 3.2 })).toEqual({ gypsum_ceiling: true, ceiling_board: "moisture", height_m: "3.2" });
    expect(bulkPatch(base)).toEqual({});
  });
  it("sets the C channel direction for many rooms (automatic = null)", async () => {
    const { bulkPatch, bulkRoomsSchema } = await import("@/lib/survey/schema");
    const base = { gypsum: "keep", board: "keep", walls: "keep", zone: "keep", ceiling: "keep", height: null } as const;
    expect(bulkPatch({ ...base, dir: "width" })).toEqual({ c_along: "width" });
    expect(bulkPatch({ ...base, dir: "auto" })).toEqual({ c_along: null });
    expect(bulkPatch({ ...base, dir: "keep" })).toEqual({});
    const id = "00000000-0000-4000-8000-000000000001";
    expect(bulkRoomsSchema.safeParse({ survey_id: id, ids: [id], patch: { c_along: null } }).success).toBe(true);
    expect(bulkRoomsSchema.safeParse({ survey_id: id, ids: [id], patch: { c_along: "diagonal" } }).success).toBe(false);
  });
});
