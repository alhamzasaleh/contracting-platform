import { CalculatorView } from "@/components/catalogue/calculator-view";
import { RatesView } from "@/components/catalogue/rates-view";
import { can, requirePermission } from "@/lib/auth/session";
import { effectiveVatPercent } from "@/lib/costing";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { loadEngineData } from "@/lib/data/engine";
import { seedPricingEngine } from "../engine-actions";

export default async function CalculatorPage() {
  const session = await requirePermission("costs.view");
  const [data, settings] = await Promise.all([loadEngineData(session), loadPricingSettings(session)]);
  if (data.products.length === 0) {
    return <RatesView rates={[]} canManage={can(session, "catalogue.manage")} onSeed={seedPricingEngine} />;
  }
  const vat = effectiveVatPercent(session.organization.vat_number, Number(settings?.vat_percent ?? 15));
  return <CalculatorView data={data} vatPercent={vat} />;
}
