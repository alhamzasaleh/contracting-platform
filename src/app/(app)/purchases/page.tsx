import { PurchasesList } from "@/components/purchases/purchase-views";
import { can, requirePermission } from "@/lib/auth/session";
import { loadPurchases } from "@/lib/data/purchases";

export default async function PurchasesPage() {
  const session = await requirePermission("purchases.view");
  return <PurchasesList purchases={await loadPurchases(session)} canManage={can(session, "purchases.manage")} />;
}
