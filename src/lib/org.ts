import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Short-lived signed URL for a private organization asset (RLS-checked). */
export async function signedAssetUrl(path: string | null, expiresIn = 60 * 60): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("org-assets").createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}
