"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    companyName: z.string().trim().min(2, "required").max(120),
    fullName: z.string().trim().min(2, "required").max(120),
  })
  .strict();

export async function createOrganization(input: z.input<typeof schema>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  await supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", auth.user.id);
  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data.companyName });
  if (error) return { ok: false, error: error.message.includes("closed") ? "closed" : "error" };

  redirect("/");
}
