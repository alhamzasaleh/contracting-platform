import { ProjectView } from "@/components/projects/project-views";
import { SAMPLE_PROJECT } from "../../../sample-projects";

/** A lump-sum contract: no quantity settlement. */
export default function P() {
  return (
    <ProjectView
      data={{ ...SAMPLE_PROJECT, payments: SAMPLE_PROJECT.payments.filter((p) => p.kind !== "measurement"), measure: { basis: { method: "lump", workTypes: [{ workType: "ceilings", area: 180, pricePerM2: 75 }], discountPercent: 0, vatPercent: 15 }, sheets: [], owed: 0 } }}
      base="/dev/preview"
    />
  );
}
