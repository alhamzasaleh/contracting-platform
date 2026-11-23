import { redirect } from "next/navigation";
import { PurchaseEditor } from "@/components/purchases/purchase-views";
import { requirePermission } from "@/lib/auth/session";
import { loadPurchaseForm } from "@/lib/data/purchases";
import { savePurchase, uploadInvoice } from "../../actions";

export default async function EditPurchasePage({ params }: { params: Promise<{ number: string }> }) {
  const session = await requirePermission("purchases.manage");
  const { number } = await params;
  const form = await loadPurchaseForm(session, decodeURIComponent(number));
  if (!form.purchase || !["draft", "rejected"].includes(form.purchase.status)) redirect(`/purchases/${number}`);
  return <PurchaseEditor form={form} actions={{ upload: uploadInvoice, save: savePurchase }} />;
}
