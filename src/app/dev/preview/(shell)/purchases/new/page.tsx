import { PurchaseEditor } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_FORM } from "../../../sample-purchases";

export default function P() {
  return <PurchaseEditor form={SAMPLE_PURCHASE_FORM} base="/dev/preview" />;
}
