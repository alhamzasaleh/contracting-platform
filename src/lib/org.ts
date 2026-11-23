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
