import { InventoryView } from "@/components/purchases/purchase-views";
import { requirePermission } from "@/lib/auth/session";
import { loadInventory } from "@/lib/data/purchases";
import { moveStock, saveItem } from "../actions";

export default async function InventoryPage() {
  const session = await requirePermission("purchases.view");
  return <InventoryView data={await loadInventory(session)} actions={{ move: moveStock, saveItem }} />;
}
