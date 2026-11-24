import { ProjectCostsView } from "@/components/purchases/purchase-views";
import { SAMPLE_COSTS } from "../../../sample-purchases";

export default function P() {
  return <ProjectCostsView rows={SAMPLE_COSTS} links={{ contracts: true, projects: true }} base="/dev/preview" />;
}
