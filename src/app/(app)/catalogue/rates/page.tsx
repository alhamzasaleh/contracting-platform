import { RatesView } from "@/components/catalogue/rates-view";
import { can, requirePermission } from "@/lib/auth/session";
import { loadRates } from "@/lib/data/engine";
import { saveRate, seedPricingEngine } from "../engine-actions";

export default async function RatesPage() {
  const session = await requirePermission("costs.view");
  const rates = await loadRates(session);
  return <RatesView rates={rates} canManage={can(session, "catalogue.manage")} onSave={saveRate} onSeed={seedPricingEngine} />;
}
