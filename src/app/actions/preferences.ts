"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isSupabaseConfigured } from "@/env";
import { LOCALE_COOKIE, NUMERALS_COOKIE } from "@/i18n/config";
import type { ActionResult } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

const prefsSchema = z
  .object({
    locale: z.enum(["ar", "en"]).optional(),
    numerals: z.enum(["latn", "arab"]).optional(),
    theme: z.enum(["system", "light", "dark"]).optional(),
    full_name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Saves personal preferences to cookies (instant) and the profile (all devices). */
export async function updatePreferences(input: z.input<typeof prefsSchema>): Promise<ActionResult> {
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const prefs = parsed.data;

  const store = await cookies();
  const cookieOpts = { path: "/", maxAge: ONE_YEAR, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };
  if (prefs.locale) store.set(LOCALE_COOKIE, prefs.locale, cookieOpts);
  if (prefs.numerals) store.set(NUMERALS_COOKIE, prefs.numerals, cookieOpts);

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user && Object.keys(prefs).length > 0) {
      const { error } = await supabase.from("profiles").update(prefs).eq("id", data.user.id);
      if (error) return { ok: false, error: "save_failed" };
    }
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
