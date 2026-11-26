import { PurchaseEditor } from "@/components/purchases/purchase-views";
import { SAMPLE_PURCHASE_DRAFT_FORM } from "../../../sample-purchases";

/** Editing a purchase draft of a project with a bill of quantities: recognised line, «خارج جدول الكميات» + link, drafts warning. */
export default function P() {
  return <PurchaseEditor form={SAMPLE_PURCHASE_DRAFT_FORM} base="/dev/preview" />;
}
