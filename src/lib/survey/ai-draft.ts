import { z } from "zod";

/**
 * §3.2 / §8.1: what the AI returns from a supervisor's voice note (transcribed
 * in the browser) and/or site photos — a measurements DRAFT for review. Nothing
 * is saved until the supervisor ticks the rows and adds them.
 */
export const surveyDraftSchema = z.object({
  rooms: z
    .array(
      z.object({
        name: z.string().describe("Room name in Arabic as spoken/written, e.g. مجلس، غرفة نوم 1، حمام"),
        unit_label: z.string().nullable().describe("Villa / floor / unit if mentioned (e.g. الدور الأول), else null"),
        length_m: z.number().nullable().describe("Length in metres; convert cm to m; null if not stated"),
        width_m: z.number().nullable().describe("Width in metres; null if not stated"),
        height_m: z.number().nullable().describe("Ceiling height in metres; null if not stated"),
        openings_m2: z.number().nullable().describe("Doors/windows area to deduct in m², if stated"),
        gypsum_ceiling: z.boolean().describe("True if a gypsum (false) ceiling is wanted in this room"),
        ceiling_board: z.enum(["normal", "moisture", "fire"]).describe("moisture for bathrooms/kitchens if said, fire if said, else normal"),
        wall_zone: z.enum(["normal", "wet", "decorative"]).describe("wet = bathrooms/kitchens walls, decorative = decorative paint requested"),
        paint_walls: z.boolean(),
        paint_ceiling: z.boolean(),
      }),
    )
    .describe("Every room measured, in the order mentioned"),
  totals: z
    .object({
      walls: z.number().nullable().describe("Total interior wall area m² if given as a total"),
      ceilings: z.number().nullable().describe("Total interior ceiling area m² if given as a total"),
      facade: z.number().nullable().describe("Exterior facade area m² if given"),
      partitions: z.number().nullable().describe("Gypsum partition area m² if given"),
      troughM: z.number().nullable().describe("Light troughs (بيت إنارة) length in metres"),
      shadowM: z.number().nullable().describe("Shadow gap length in metres"),
      crackM: z.number().nullable().describe("Cracks to treat, metres"),
      colours: z.number().nullable().describe("Number of wall colours if said"),
    })
    .describe("Totals stated directly (not computed from rooms)"),
  unclear: z.array(z.string()).describe("Short Arabic notes about anything unclear or missing, e.g. «ارتفاع الحمام غير مذكور»"),
});
export type SurveyDraft = z.infer<typeof surveyDraftSchema>;

/** A room row ready for the room form (missing height falls back to the survey's usual height). */
export type DraftRoom = {
  name: string; unit_label: string | null; length_m: number | null; width_m: number | null; height_m: number | null; openings_m2: number;
  gypsum_ceiling: boolean; ceiling_board: "normal" | "moisture" | "fire"; wall_zone: "normal" | "wet" | "decorative"; paint_walls: boolean; paint_ceiling: boolean;
  /** what still needs the supervisor's eye */
  missing: ("length" | "width" | "height")[];
};

const ok = (v: number | null, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : null);

/** Keep only plausible numbers, name each room, fill the height from the usual one, and list what's missing. */
export function cleanDraft(d: SurveyDraft, usualHeight: number | null): { rooms: DraftRoom[]; totals: Partial<Record<keyof SurveyDraft["totals"], number>>; unclear: string[] } {
  const rooms = d.rooms.slice(0, 60).map((r, i) => {
    const length_m = ok(r.length_m, 200);
    const width_m = ok(r.width_m, 200);
    const stated = ok(r.height_m, 30);
    const height_m = stated ?? (usualHeight && usualHeight > 0 ? usualHeight : null);
    const missing: DraftRoom["missing"] = [];
    if (length_m == null) missing.push("length");
    if (width_m == null) missing.push("width");
    if (stated == null) missing.push("height");
    return {
      name: r.name.trim().slice(0, 80) || `غرفة ${i + 1}`,
      unit_label: r.unit_label?.trim().slice(0, 60) || null,
      length_m, width_m, height_m,
      openings_m2: ok(r.openings_m2, 10000) ?? 0,
      gypsum_ceiling: r.gypsum_ceiling, ceiling_board: r.ceiling_board, wall_zone: r.wall_zone,
      paint_walls: r.paint_walls, paint_ceiling: r.paint_ceiling,
      missing,
    };
  });
  const totals = Object.fromEntries(
    Object.entries(d.totals)
      .map(([k, v]) => [k, ok(v, k === "colours" ? 20 : 100000)] as const)
      .filter(([, v]) => v != null),
  ) as Partial<Record<keyof SurveyDraft["totals"], number>>;
  return { rooms, totals, unclear: d.unclear.slice(0, 20).map((u) => u.slice(0, 200)) };
}

export type SurveyDraftResult = ReturnType<typeof cleanDraft>;
