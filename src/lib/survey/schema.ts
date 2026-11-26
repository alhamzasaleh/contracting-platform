import { z } from "zod";
import { roomSize } from "@/lib/survey/plan";

const area = z.number().min(0).max(1_000_000);
const HATCH_SIZES = ["30x30", "40x40", "50x50", "60x60", "60x120"] as const;

/**
 * Totals of a survey entered as total areas. Every field is optional — the supervisor fills only what
 * the client needs. Hatches are counted per size and **any subset of sizes** may be given (Zod 4's
 * `z.record(z.enum(…))` demands every key, which silently refused a save with one hatch size).
 */
export const surveyTotalsSchema = z
  .object({
    ceilNormal: area, ceilMoisture: area, ceilFire: area, partitions: area, troughM: area, shadowM: area,
    hatches: z.partialRecord(z.enum(HATCH_SIZES), z.number().int().min(0).max(1000)),
    walls: area, ceilings: area, wet: area, decorative: area,
    colours: z.number().int().min(1).max(30), ceilingColours: z.number().int().min(1).max(30), crackM: area,
    facade: area, extColours: z.number().int().min(1).max(30), scaffoldDays: z.number().min(0).max(1000),
  })
  .partial()
  .strict();

/** num() of the room form: Arabic digits, a comma decimal, the room form's limits */
const height = z.preprocess((v) => (typeof v === "string" ? roomSize(v, 30) ?? Number.NaN : v), z.number().min(0.01).max(30));

/**
 * «تطبيق على عدة غرف» (owner, Nov 2026): the same services for many rooms of one survey at once —
 * only the settings given change, every other field of each room stays as it is.
 */
export const bulkRoomsSchema = z
  .object({
    survey_id: z.uuid(),
    ids: z.array(z.uuid()).min(1).max(300),
    patch: z
      .object({
        gypsum_ceiling: z.boolean(),
        ceiling_board: z.enum(["normal", "moisture", "fire"]),
        paint_walls: z.boolean(),
        paint_ceiling: z.boolean(),
        wall_zone: z.enum(["normal", "wet", "decorative"]),
        height_m: height,
      })
      .partial()
      .strict()
      .refine((p) => Object.keys(p).length > 0, "empty"),
  })
  .strict();

export type BulkScope = { kind: "all" } | { kind: "floor"; floor: string | null } | { kind: "pick"; ids: string[] };

/** The rooms a bulk change applies to, in the survey's order. */
export function bulkTargets(rooms: { id: string; unit_label: string | null }[], scope: BulkScope): string[] {
  if (scope.kind === "all") return rooms.map((r) => r.id);
  if (scope.kind === "floor") return rooms.filter((r) => (r.unit_label ?? null) === scope.floor).map((r) => r.id);
  const picked = new Set(scope.ids);
  return rooms.filter((r) => picked.has(r.id)).map((r) => r.id);
}

export type BulkChoice = {
  gypsum: "keep" | "yes" | "no";
  board: "keep" | "normal" | "moisture" | "fire";
  walls: "keep" | "yes" | "no";
  zone: "keep" | "normal" | "wet" | "decorative";
  ceiling: "keep" | "yes" | "no";
  height: number | null;
};

/** The settings to send: «بدون تغيير» and choices hidden on screen (board with gypsum «no», wall zone with wall paint «no») are left out. */
export function bulkPatch(c: BulkChoice): Record<string, string | boolean> {
  return {
    ...(c.gypsum !== "keep" && { gypsum_ceiling: c.gypsum === "yes" }),
    ...(c.board !== "keep" && c.gypsum !== "no" && { ceiling_board: c.board }),
    ...(c.walls !== "keep" && { paint_walls: c.walls === "yes" }),
    ...(c.zone !== "keep" && c.walls !== "no" && { wall_zone: c.zone }),
    ...(c.ceiling !== "keep" && { paint_ceiling: c.ceiling === "yes" }),
    ...(c.height != null && { height_m: String(c.height) }),
  };
}
