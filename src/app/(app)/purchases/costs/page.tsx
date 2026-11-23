import { ProjectCostsView } from "@/components/purchases/purchase-views";
import { can, requirePermission } from "@/lib/auth/session";
import { loadProjectCosts } from "@/lib/data/purchases";

export default async function CostsPage() {
  const session = await requirePermission("quotes.view");
  return <ProjectCostsView rows={await loadProjectCosts(session)} labourHidden={can(session, "costs.view") && !can(session, "hr.view")} />;
}
