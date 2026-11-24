import { PurchaseView } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_DETAIL } from "../../../sample-purchases";
import { previewNoop } from "../../../preview-actions";

/** A recorded purchase waiting for the supplier payment (finance). */
export default function P() {
  const d = { ...SAMPLE_PURCHASE_DETAIL.purchase, status: "recorded" as const, approval: null };
  return <PurchaseView detail={d} items={SAMPLE_PURCHASE_DETAIL.items} base="/dev/preview" actions={{ cancel: previewNoop, decide: previewNoop, pay: previewNoop }} />;
}
