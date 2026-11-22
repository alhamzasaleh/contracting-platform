"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  brandSchema,
  companySchema,
  isSafeSvg,
  LOGO_MAX_BYTES,
  sniffImageType,
  type CompanyInput,
} from "@/lib/validation/company";

export async function updateCompany(input: CompanyInput): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };

  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update(parsed.data).eq("id", session.organization.id);
  if (error) return { ok: false, error: "error" };

  revalidatePath("/", "layout");
  return { ok: true };
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

/** Saves brand colours and (optionally) a new logo in one step. */
export async function saveBranding(formData: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };

  const brand = brandSchema.safeParse({
    primary: formData.get("primary"),
    accent: formData.get("accent") || null,
    source: formData.get("source"),
  });
  if (!brand.success) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const orgId = session.organization.id;
  let logoPath = session.organization.logo_path;

  const file = formData.get("logo");
  if (file instanceof File && file.size > 0) {
    if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "tooLarge" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return { ok: false, error: "badType" };
    if (type === "image/svg+xml" && !isSafeSvg(new TextDecoder().decode(bytes))) {
      return { ok: false, error: "badType" };
    }
    const path = `${orgId}/logo-${Date.now()}.${EXT[type]}`;
    const { error: upErr } = await supabase.storage
      .from("org-assets")
      .upload(path, bytes, { contentType: type, upsert: false, cacheControl: "3600" });
    if (upErr) return { ok: false, error: "error" };
    if (logoPath && logoPath !== path) await supabase.storage.from("org-assets").remove([logoPath]);
    logoPath = path;
  }

  const { error } = await supabase
    .from("organizations")
    .update({ brand: brand.data, logo_path: logoPath })
    .eq("id", orgId);
  if (error) return { ok: false, error: "error" };

  revalidatePath("/", "layout");
  return { ok: true };
}

const removeLogoSchema = z.object({}).strict();
export async function removeLogo(input: z.input<typeof removeLogoSchema> = {}): Promise<ActionResult> {
  if (!removeLogoSchema.safeParse(input).success) return { ok: false, error: "invalid" };
  const session = await getSession();
  if (!can(session, "settings.manage")) return { ok: false, error: "noAccess" };
  const supabase = await createClient();
  if (session.organization.logo_path) {
    await supabase.storage.from("org-assets").remove([session.organization.logo_path]);
  }
  const { error } = await supabase.from("organizations").update({ logo_path: null }).eq("id", session.organization.id);
  if (error) return { ok: false, error: "error" };
  revalidatePath("/", "layout");
  return { ok: true };
}
