import "server-only";
import { staffNames } from "@/lib/hr/access";
import { rows } from "@/lib/data/query";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Names of these accounts for staff pages: the linked employee's «name · job»
 * (public.staff_employee_names — no hr data), else the account's name, else its local phone.
 * Reads only the profiles asked for.
 */
export async function loadStaffNames(supabase: Client, orgId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const [profiles, employees] = await Promise.all([
    rows(supabase.from("profiles").select("id, full_name, phone").in("id", wanted)),
    rows(supabase.rpc("staff_employee_names", { p_org: orgId })),
  ]);
  return staffNames(profiles, employees);
}
