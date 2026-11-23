import { PurchaseEditor } from "@/components/purchases/purchase-views";
import { requirePermission } from "@/lib/auth/session";
import { loadPurchaseForm } from "@/lib/data/purchases";
import { savePurchase, uploadInvoice } from "../actions";

export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const session = await requirePermission("purchases.manage");
  const { project } = await searchParams;
  const form = await loadPurchaseForm(session);
  const initial = form.projects.find((p) => p.number === project)?.id;
  return <PurchaseEditor form={form} initialProject={initial} actions={{ upload: uploadInvoice, save: savePurchase }} />;
}
