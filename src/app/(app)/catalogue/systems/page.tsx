import { SystemsView } from "@/components/catalogue/systems-view";
import { can, getSession } from "@/lib/auth/session";
import { loadSystems } from "@/lib/data/engine";
import { saveComponentInclusion, saveComponentVariants, saveSystemSpec, seedPricingEngine } from "../engine-actions";

export default async function SystemsPage() {
  const session = await getSession();
  const systems = await loadSystems(session);
  return (
    <SystemsView
      systems={systems}
      canManage={can(session, "catalogue.manage")}
      canSeed={can(session, "catalogue.manage") && can(session, "costs.view")}
      onSaveSpec={saveSystemSpec}
      onSaveInclusion={saveComponentInclusion}
      onSaveVariants={saveComponentVariants}
      onSeed={seedPricingEngine}
    />
  );
}
