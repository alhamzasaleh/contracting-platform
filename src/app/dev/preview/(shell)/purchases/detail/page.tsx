import { PurchaseView } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_DETAIL } from "../../../sample-purchases";
import { previewNoop } from "../../../preview-actions";

export default function P() {
  return <PurchaseView detail={SAMPLE_PURCHASE_DETAIL.purchase} items={SAMPLE_PURCHASE_DETAIL.items} base="/dev/preview" actions={{ cancel: previewNoop, decide: previewNoop, pay: previewNoop }} />;
}
