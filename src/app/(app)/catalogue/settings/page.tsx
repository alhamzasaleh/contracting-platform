import { PricingSettingsView } from "@/components/catalogue/pricing-settings-view";
import { can, requirePermission } from "@/lib/auth/session";
import { effectiveVatPercent } from "@/lib/costing";
import { loadPricingSettings } from "@/lib/data/catalogue";
import type { PricingSettingsRow } from "@/lib/supabase/database.types";
import { savePricingSettings } from "../actions";

export default async function PricingSettingsPage() {
  const session = await requirePermission("costs.view");
  const row = await loadPricingSettings(session);
  const settings: PricingSettingsRow = row ?? {
    organization_id: session.organization.id,
    overhead_percent: 0,
    min_margin_percent: 20,
    default_margin_percent: 25,
    vat_percent: 15,
    default_waste_percent: 5,
    default_warranty_months: 6,
    purchase_approval_limit: null,
    working_days_per_month: 26,
    first_payment_material_cover_percent: 75,
    created_at: "",
    created_by: null,
    updated_at: "",
  };
  return (
    <PricingSettingsView
      settings={settings}
      vatRegistered={effectiveVatPercent(session.organization.vat_number, 15) > 0}
      canManage={can(session, "catalogue.manage")}
      onSave={savePricingSettings}
    />
  );
}
