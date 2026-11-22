import { LabourView } from "@/components/catalogue/labour-view";
import { can, requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deleteExtraCost, deleteLabourRate, saveExtraCost, saveLabourRate } from "../actions";

export default async function LabourPage() {
  const session = await requirePermission("costs.view");
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: labour }, { data: extras }, { data: services }] = await Promise.all([
    supabase.from("labour_rates").select("*").eq("organization_id", orgId).order("created_at"),
    supabase.from("extra_cost_items").select("*").eq("organization_id", orgId).order("created_at"),
    supabase.from("services").select("id, name_ar").eq("organization_id", orgId).order("sort_order"),
  ]);
  return (
    <LabourView
      labour={(labour ?? []).map((l) => ({ ...l, rate: Number(l.rate) }))}
      extras={(extras ?? []).map((x) => ({ ...x, default_amount: Number(x.default_amount) }))}
      services={services ?? []}
      canManage={can(session, "catalogue.manage")}
      actions={{ saveLabour: saveLabourRate, deleteLabour: deleteLabourRate, saveExtra: saveExtraCost, deleteExtra: deleteExtraCost }}
    />
  );
}
