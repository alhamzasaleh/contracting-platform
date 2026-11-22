import { PricingSettingsView } from "@/components/catalogue/pricing-settings-view";

export default function P() {
  return (
    <PricingSettingsView
      basePath="/dev/preview"
      canManage
      vatRegistered={false}
      settings={{
        organization_id: "x",
        overhead_percent: 8,
        min_margin_percent: 20,
        default_margin_percent: 25,
        vat_percent: 15,
        default_waste_percent: 5,
        default_warranty_months: 6,
        purchase_approval_limit: 10000,
        working_days_per_month: 26,
        first_payment_material_cover_percent: 75,
        created_at: "",
        created_by: null,
        updated_at: "",
      }}
    />
  );
}
