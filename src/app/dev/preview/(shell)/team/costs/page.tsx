import { CostItemsView } from "@/components/team/cost-items-view";
import { SAMPLE_COST_ITEMS } from "../../../sample-catalogue";

export default function P() {
  return <CostItemsView items={SAMPLE_COST_ITEMS} canManage />;
}
