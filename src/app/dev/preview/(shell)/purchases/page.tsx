import { PurchasesList } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASES } from "../../sample-purchases";

export default function P() {
  return <PurchasesList purchases={SAMPLE_PURCHASES} canManage base="/dev/preview" />;
}
