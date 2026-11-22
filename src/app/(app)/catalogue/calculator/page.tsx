import { RatesView } from "@/components/catalogue/rates-view";
import { PricingView } from "@/components/pricing/pricing-view";
import { can, requirePermission } from "@/lib/auth/session";
import { loadPricingContext } from "@/lib/data/pricing";
import { seedPricingEngine } from "../engine-actions";
import { savePricingTemplate } from "../pricing-actions";

export default async function PricingPage() {
  const session = await requirePermission("costs.view");
  const { ctx, templates, canSeeCrewCost } = await loadPricingContext(session);
  if (ctx.catalogue.products.length === 0) {
    return <RatesView rates={[]} canManage={can(session, "catalogue.manage")} onSeed={seedPricingEngine} />;
  }
  return <PricingView ctx={ctx} templates={templates} canManage={can(session, "catalogue.manage")} canSeeCrewCost={canSeeCrewCost} onSaveTemplate={savePricingTemplate} />;
}
