import "server-only";
import type { SessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function loadCostItems(session: SessionContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employee_cost_items")
    .select("id, code, name_ar, applies_to, basis, value, amortize_months, is_active, is_provision, last_reviewed_at")
    .eq("organization_id", session.organization.id)
    .order("sort_order");
  return (data ?? []).map((i) => ({ ...i, value: Number(i.value) }));
}
