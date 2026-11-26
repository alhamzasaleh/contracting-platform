import { PurchaseEditor } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_FORM } from "../../../sample-purchases";

/** A purchase not tied to a project yet: one blank line (stock purchase, or the project picked later). */
export default function P() {
  return <PurchaseEditor form={SAMPLE_PURCHASE_FORM} base="/dev/preview" />;
}
