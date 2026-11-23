"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { selectionSchema } from "@/lib/pricing/schema";
import { createClient } from "@/lib/supabase/server";

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
