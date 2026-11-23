import { PurchaseView } from "@/components/purchases/purchase-views";
import { requirePermission } from "@/lib/auth/session";
import { loadPurchaseForm } from "@/lib/data/purchases";
import { cancelPurchase, decidePurchase } from "../actions";

export default async function PurchasePage({ params }: { params: Promise<{ number: string }> }) {
  const session = await requirePermission("purchases.view");
  const { number } = await params;
  const form = await loadPurchaseForm(session, decodeURIComponent(number));
  return <PurchaseView detail={form.purchase!} items={form.items} actions={{ cancel: cancelPurchase, decide: decidePurchase }} />;
}
