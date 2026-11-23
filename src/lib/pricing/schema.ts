import { z } from "zod";

/** Validates a pricing template (default choices for one service). */
const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export const selectionSchema = z
  .object({
    kind: z.enum(["gypsum", "interior", "exterior"]),
    options: z
      .object({
        method: z.enum(["roller", "profile", "spray"]),
        variant: z.enum(["new", "repaint"]),
        suspension: z.enum(["rod", "vertical_c"]),
        layers: z.number().int().min(1).max(3),
        hangingHeight: z.number().min(0.05).max(3),
        cSpacing: z.number().min(0.2).max(2),
        omegaSpacing: z.number().min(0.1).max(1),
        projectType: z.enum(["full", "labour", "supply"]).optional(),
      })
      .strict(),
    steps: z.record(
      key,
      z
        .object({
          lineId: z.uuid().nullable(),
          brand: z.string().max(80).nullable(),
          coats: z.record(key, z.number().int().min(0).max(6)),
          on: z.boolean(),
        })
        .strict(),
    ),
    excluded: z.array(key).max(40),
    labour: z.discriminatedUnion("source", [
      z.object({ source: z.literal("rates") }).strict(),
      z.object({ source: z.literal("external"), externalId: z.uuid().nullable() }).strict(),
      z.object({ source: z.literal("inhouse"), crew: z.array(z.uuid()).max(50), teamId: z.uuid().nullable().optional() }).strict(),
    ]),
    marginPercent: z.number().min(0).max(90).nullable(),
    contingencyPercent: z.number().min(0).max(50).nullable().optional(),
  })
  .strict();

