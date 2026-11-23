import { InventoryView } from "@/components/purchases/purchase-views";
import { SAMPLE_INVENTORY } from "../../../sample-purchases";

export default function P() {
  return <InventoryView data={SAMPLE_INVENTORY} />;
}
