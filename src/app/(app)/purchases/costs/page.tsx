import { ProjectCostsView } from "@/components/purchases/purchase-views";
import { can, requirePermission } from "@/lib/auth/session";
import { loadProjectCosts } from "@/lib/data/purchases";

export default async function CostsPage() {
  const session = await requirePermission("costs.view");
  return <ProjectCostsView rows={await loadProjectCosts(session)} links={{ contracts: can(session, "quotes.view"), projects: can(session, "projects.view") }} labourHidden={can(session, "costs.view") && !can(session, "hr.view")} />;
}
