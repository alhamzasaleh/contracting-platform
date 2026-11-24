import { SubcontractorsView } from "@/components/purchases/sub-petty-views";
import { SAMPLE_SUBS } from "../../../sample-subs";
import { previewNoop } from "../../../preview-actions";

export default function P() {
  return <SubcontractorsView data={SAMPLE_SUBS} actions={{ saveSub: previewNoop as never, saveAgreement: previewNoop, addWork: previewNoop, deleteWork: previewNoop, addPayment: previewNoop }} />;
}
