import { ReportsView } from "@/components/finance/reports-view";
import { SAMPLE_FINANCE } from "../../sample-finance";

export default function P() {
  return <ReportsView f={SAMPLE_FINANCE} base="/dev/preview" />;
}
