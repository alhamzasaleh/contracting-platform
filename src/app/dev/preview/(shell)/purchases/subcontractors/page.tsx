import { SubcontractorsView } from "@/components/purchases/sub-petty-views";
import { previewNoop, previewSubLink } from "../../../preview-actions";
import { SAMPLE_SUBS } from "../../../sample-subs";

export default function P() {
  return (
    <SubcontractorsView
      data={SAMPLE_SUBS}
      base="/dev/preview"
      orgName="مؤسسة ملمس"
      actions={{ saveSub: previewNoop as never, saveAgreement: previewNoop, addWork: previewNoop, deleteWork: previewNoop, addPayment: previewNoop, issueLink: previewSubLink, revokeLinks: previewNoop }}
    />
  );
}
