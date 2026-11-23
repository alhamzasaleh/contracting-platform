import { ReportsView } from "@/components/finance/reports-view";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_FINANCE } from "../../sample-finance";

export default function P() {
  return <ReportsView f={SAMPLE_FINANCE} base="/dev/preview" actions={{ record: previewNoop, expected: previewNoop, request: previewNoop }} />;
}
