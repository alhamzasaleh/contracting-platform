import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "./database.types";

/**
 * Service-role client: BYPASSES RLS. Use only in server code for narrowly
 * scoped, pre-validated operations (rate limiting, phone allow-list,
 * signed URLs for already-authorised files). Never pass user input
 * through without validation, never return its raw results to the client.
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
