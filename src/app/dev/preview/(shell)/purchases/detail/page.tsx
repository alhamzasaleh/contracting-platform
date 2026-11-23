import { PurchaseView } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_DETAIL } from "../../../sample-purchases";

export default function P() {
  return <PurchaseView detail={SAMPLE_PURCHASE_DETAIL.purchase} items={SAMPLE_PURCHASE_DETAIL.items} base="/dev/preview" />;
}
