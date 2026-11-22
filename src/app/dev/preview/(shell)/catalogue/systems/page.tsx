import { SystemsView } from "@/components/catalogue/systems-view";
import { SAMPLE_SYSTEMS } from "../../../sample-engine";

export default function P() {
  return <SystemsView systems={SAMPLE_SYSTEMS} canManage canSeed />;
}
