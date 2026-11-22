"use client";
import { createBrowserClient } from "@supabase/ssr";
import { normalizeSupabaseUrl } from "@/env";
import type { Database } from "./database.types";

export function createClient() {
  return createBrowserClient<Database>(
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
