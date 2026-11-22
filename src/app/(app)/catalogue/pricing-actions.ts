"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** Validates a pricing template (default choices for one service). */
const key = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const selectionSchema = z
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
      z.object({ source: z.literal("inhouse"), crew: z.array(z.uuid()).max(50) }).strict(),
    ]),
    marginPercent: z.number().min(0).max(90).nullable(),
  })
  .strict();

export async function savePricingTemplate(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "catalogue.manage")) return { ok: false, error: "noAccess" };
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pricing_templates")
    .upsert({ organization_id: session.organization.id, service: parsed.data.kind, data: parsed.data }, { onConflict: "organization_id,service" });
  if (error) {
    console.error("[pricing] template save failed", { code: error.code });
    return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
  }
  revalidatePath("/catalogue", "layout");
  return { ok: true };
}
