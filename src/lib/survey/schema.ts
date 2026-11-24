import { z } from "zod";

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
