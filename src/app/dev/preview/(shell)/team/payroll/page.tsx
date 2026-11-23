import { PayrollView } from "@/components/team/payroll-view";
import { SAMPLE_PAYROLL } from "../../../sample-payroll";

export default function P() {
  return <PayrollView data={SAMPLE_PAYROLL} today="2026-11-23" base="/dev/preview" />;
}
