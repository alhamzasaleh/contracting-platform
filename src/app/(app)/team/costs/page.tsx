import { CostItemsView } from "@/components/team/cost-items-view";
import { can, getSession } from "@/lib/auth/session";
import { loadCostItems } from "@/lib/data/team";
import { saveCostItem, seedCostItems } from "../actions";

export default async function CostsPage() {
  const session = await getSession();
  const items = await loadCostItems(session);
  return <CostItemsView items={items} canManage={can(session, "hr.manage")} actions={{ seed: seedCostItems, save: saveCostItem }} />;
}
