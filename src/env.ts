import { z } from "zod";

/**
 * Environment variables, validated once. Public values may reach the
 * browser; everything in `serverEnv` must never be imported by client code.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
}

/** True when Supabase hasn't been connected yet (first deploy). */
export function isSupabaseConfigured() {
  return publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }).success;
}

/**
 * The design preview (sample data only, no database access) is available in
 * development and on Vercel preview deployments, never in production.
 */
export function isDesignPreviewEnabled() {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.VERCEL_ENV === "preview" && process.env.ENABLE_DESIGN_PREVIEW === "1";
}
