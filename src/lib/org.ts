import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Short-lived signed URL for a private organization asset (RLS-checked). */
export async function signedAssetUrl(path: string | null, expiresIn = 60 * 60): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("org-assets").createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

const MAX_INLINE = 300 * 1024;

/** A small file as a data URL (same origin, so CSS masks work without CORS). */
export async function blobToDataUrl(blob: Blob | null): Promise<string | null> {
  if (!blob || blob.size > MAX_INLINE) return null;
  const type = blob.type && /^image\/(png|jpeg|webp|svg\+xml)$/.test(blob.type) ? blob.type : "image/png";
  return `data:${type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
}

/**
 * The company logo for display (§6.1): embedded as a data URL so `BrandLogo`
 * can use it as a CSS mask and colour it per background; falls back to a
 * signed URL for unusually large files. Cached per request.
 */
export const logoDataUrl = cache(async (path: string | null): Promise<string | null> => {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("org-assets").download(path);
  return (await blobToDataUrl(data)) ?? (await signedAssetUrl(path));
});

const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
type OrgLogoSource = { logo_path: string | null; logo_svg?: string | null; logo_compact_svg?: string | null };

/** The full logo (SVG when the approved file is stored, else the uploaded image). */
export async function orgLogoUrl(org: OrgLogoSource): Promise<string | null> {
  return org.logo_svg ? svgDataUrl(org.logo_svg) : logoDataUrl(org.logo_path);
}

/** The Arabic-only logo for small sizes (§6.1: under 120 px), when available. */
export function orgCompactLogoUrl(org: OrgLogoSource): string | null {
  return org.logo_compact_svg ? svgDataUrl(org.logo_compact_svg) : null;
}

/**
 * The sign-in page's identity, before anyone is signed in: while the platform
 * serves a single company, its name and logo (nothing else). With several
 * companies (SaaS) the page stays neutral.
 */
export const publicIdentity = cache(async (): Promise<{ name: string; logoUrl: string | null } | null> => {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data } = await admin.from("organizations").select("name, logo_path, logo_svg").limit(2);
    if (!data || data.length !== 1) return null;
    const org = data[0];
    if (org.logo_svg) return { name: org.name, logoUrl: svgDataUrl(org.logo_svg) };
    if (!org.logo_path) return { name: org.name, logoUrl: null };
    const { data: file } = await admin.storage.from("org-assets").download(org.logo_path);
    return { name: org.name, logoUrl: await blobToDataUrl(file) };
  } catch {
    return null;
  }
});
