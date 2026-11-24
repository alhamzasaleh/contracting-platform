import { PayrollView } from "@/components/team/payroll-view";
import { SAMPLE_PAYROLL } from "../../../sample-payroll";
import { previewNoop } from "../../../preview-actions";

export default function P() {
  return <PayrollView data={SAMPLE_PAYROLL} today="2026-11-23" base="/dev/preview" actions={{ create: previewNoop, update: previewNoop, approve: previewNoop, paid: previewNoop, addAdvance: previewNoop, deleteAdvance: previewNoop }} />;
}
