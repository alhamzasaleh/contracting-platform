/**
 * Database types for the Supabase client.
 * Hand-maintained until the project is linked; then regenerate with
 *   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Timestamps = { created_at: string };

export type Brand = { primary: string; accent?: string | null; source?: "logo" | "manual" | "default" };

export type OrganizationRow = Timestamps & {
  id: string;
  name: string;
  legal_name: string | null;
  cr_number: string | null;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  logo_path: string | null;
  brand: Brand;
  default_locale: "ar" | "en";
  timezone: string;
  currency: string;
  created_by: string | null;
  updated_at: string;
};

export type ProfileRow = Timestamps & {
  id: string;
  full_name: string | null;
  phone: string | null;
  locale: "ar" | "en";
  numerals: "latn" | "arab";
  theme: "system" | "light" | "dark";
  default_organization_id: string | null;
  updated_at: string;
};

export type MembershipRow = Timestamps & {
  id: string;
  organization_id: string;
  user_id: string;
  role: "owner" | "supervisor" | "finance" | "viewer";
  status: "active" | "suspended";
  permission_overrides: { grant?: string[]; deny?: string[] };
  project_scope: "all" | "assigned";
  approval_limit: number | null;
  created_by: string | null;
  updated_at: string;
};

export type InvitationRow = Timestamps & {
  id: string;
  organization_id: string;
  phone: string;
  full_name: string | null;
  role: "supervisor" | "finance" | "viewer";
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_by: string | null;
};

export type AuditRow = Timestamps & {
  id: number;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  before: Json | null;
  after: Json | null;
};


export type PricingSettingsRow = {
  organization_id: string;
  overhead_percent: number;
  min_margin_percent: number;
  default_margin_percent: number;
  vat_percent: number;
  default_waste_percent: number;
  default_warranty_months: number;
  purchase_approval_limit: number | null;
  working_days_per_month: number;
  first_payment_material_cover_percent: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

type OrgRow = Timestamps & { id: string; organization_id: string; created_by: string | null };
type Upd = { updated_at: string };

export type ServiceRow = OrgRow & Upd & {
  code: string;
  name_ar: string;
  name_en: string | null;
  description: string | null;
  unit: "m2" | "m" | "piece" | "lump";
  waste_percent: number | null;
  is_active: boolean;
  sort_order: number;
};

export type ServiceStageRow = OrgRow & Upd & {
  service_id: string;
  sort_order: number;
  kind: "prep" | "work" | "handover";
  name_ar: string;
  name_en: string | null;
  productivity_per_day: number | null;
  fixed_days: number;
  notes: string | null;
};

export type SpecTemplateRow = OrgRow & Upd & {
  service_id: string;
  title: string;
  body: string;
  is_default: boolean;
  sort_order: number;
};

export const MATERIAL_UNITS = ["piece", "m2", "m", "kg", "liter", "gallon", "bag", "roll", "box", "bucket", "sheet", "carton", "ton"] as const;
export type MaterialUnit = (typeof MATERIAL_UNITS)[number];

export type MaterialRow = OrgRow & Upd & {
  name_ar: string;
  name_en: string | null;
  category: string | null;
  unit: MaterialUnit;
  scope: "general" | "project";
  sku: string | null;
  is_active: boolean;
  notes: string | null;
  brand: string | null;
  package_desc: string | null;
  coverage_per_unit: number | null;
  preferred_supplier_id: string | null;
};

export type SupplierRow = OrgRow & Upd & {
  name: string;
  contact_name: string | null;
  phone: string | null;
  vat_number: string | null;
  city: string | null;
  notes: string | null;
  is_active: boolean;
};

export type MaterialPriceRow = OrgRow & {
  material_id: string;
  unit_price: number;
  effective_from: string;
  source: string | null;
  supplier_id: string | null;
};

export type MaterialCurrentPriceRow = {
  material_id: string;
  organization_id: string;
  unit_price: number;
  effective_from: string;
  created_at: string;
  supplier_id: string | null;
};

export type RecipeRow = OrgRow & Upd & {
  service_id: string;
  material_id: string;
  qty_per_unit: number | null;
  waste_percent: number | null;
  notes: string | null;
  calc_mode: "fixed" | "coverage";
  coats: number;
};

export type LabourRateRow = OrgRow & Upd & {
  service_id: string | null;
  name: string;
  basis: "external_per_unit" | "external_lump";
  rate: number;
  notes: string | null;
  is_active: boolean;
};

export type ExtraCostItemRow = OrgRow & Upd & {
  name: string;
  unit: "lump" | "day" | "trip" | "month";
  default_amount: number;
  is_active: boolean;
};

export type EmployeeRow = OrgRow & Upd & {
  full_name: string;
  is_saudi: boolean;
  nationality: string | null;
  job_title: string | null;
  phone: string | null;
  id_number: string | null;
  id_expiry: string | null;
  passport_expiry: string | null;
  insurance_expiry: string | null;
  start_date: string | null;
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  iban: string | null;
  status: "active" | "on_leave" | "final_exit";
  notes: string | null;
};

export type EmployeeCostItemRow = OrgRow & Upd & {
  code: string;
  name_ar: string;
  applies_to: "all" | "saudi" | "non_saudi";
  basis: "percent" | "monthly" | "annual" | "one_time";
  value: number;
  amortize_months: number | null;
  is_active: boolean;
  last_reviewed_at: string | null;
  sort_order: number;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      organizations: Table<OrganizationRow>;
      profiles: Table<ProfileRow>;
      memberships: Table<MembershipRow, Pick<MembershipRow, "organization_id" | "user_id" | "role"> & Partial<MembershipRow>>;
      member_invitations: Table<
        InvitationRow,
        Pick<InvitationRow, "organization_id" | "phone" | "role"> & Partial<InvitationRow>
      >;
      audit_log: Table<AuditRow>;
      pricing_settings: Table<PricingSettingsRow>;
      services: Table<ServiceRow>;
      service_stages: Table<ServiceStageRow>;
      spec_templates: Table<SpecTemplateRow>;
      materials: Table<MaterialRow>;
      material_prices: Table<MaterialPriceRow>;
      service_material_recipes: Table<RecipeRow>;
      labour_rates: Table<LabourRateRow>;
      extra_cost_items: Table<ExtraCostItemRow>;
      employees: Table<EmployeeRow>;
      employee_cost_items: Table<EmployeeCostItemRow>;
      suppliers: Table<SupplierRow>;
    };
    Views: {
      material_current_prices: { Row: MaterialCurrentPriceRow; Relationships: [] };
      material_supplier_prices: { Row: MaterialCurrentPriceRow; Relationships: [] };
    };
    Functions: {
      create_organization: { Args: { p_name: string }; Returns: string };
      can_create_organization: { Args: Record<string, never>; Returns: boolean };
      accept_pending_invitations: { Args: Record<string, never>; Returns: number };
      my_permissions: { Args: { p_org: string }; Returns: string[] };
      auth_phone_allowed: { Args: { p_phone: string }; Returns: boolean };
      check_rate_limit: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
      seed_starter_catalogue: { Args: { p_org: string }; Returns: number };
      seed_employee_cost_items: { Args: { p_org: string }; Returns: number };
      log_event: {
        Args: { p_org: string; p_action: string; p_entity: string; p_entity_id: string; p_details?: Json };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
