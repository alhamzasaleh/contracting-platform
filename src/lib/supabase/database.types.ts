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
  signatory_name: string | null;
  signatory_title: string | null;
  logo_path: string | null;
  /** approved logo as SVG text (full / Arabic-only), set by migrations — preferred over logo_path */
  logo_svg?: string | null;
  logo_compact_svg?: string | null;
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
  /** the same contractor in subcontractors/teams (linked by a trigger) */
  subcontractor_id?: string | null;
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
  /** an accrual (end-of-service, annual leave): part of the loaded cost, not monthly cash */
  is_provision: boolean;
  last_reviewed_at: string | null;
  sort_order: number;
};


export const PRODUCT_CATEGORIES = [
  "putty", "primer", "sealer", "finish_paint", "ceiling_paint", "profile_texture", "spray_paint", "moisture_paint",
  "decorative", "exterior_primer", "exterior_putty", "exterior_paint", "crack_material", "sundry",
  "gypsum_board", "c_channel", "omega", "stud", "track", "hanger_rod", "vertical_hanger", "angle",
  "trough_angle", "shadow_profile", "screws", "washers", "anchors", "clips", "tape", "joint_compound",
  "insulation", "hatch", "other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductFamily = "paint" | "gypsum" | "other";
const PAINT_CATEGORIES: readonly ProductCategory[] = [
  "putty", "primer", "sealer", "finish_paint", "ceiling_paint", "profile_texture", "spray_paint", "moisture_paint", "decorative",
  "exterior_primer", "exterior_putty", "exterior_paint", "crack_material",
];
const GYPSUM_CATEGORIES: readonly ProductCategory[] = [
  "gypsum_board", "c_channel", "omega", "stud", "track", "hanger_rod", "vertical_hanger", "angle", "trough_angle",
  "shadow_profile", "screws", "washers", "anchors", "clips", "tape", "joint_compound", "insulation", "hatch",
];
/** Which family a product category belongs to — brands supply families (paint brands don't make boards). */
export function familyOf(c: ProductCategory): ProductFamily {
  return PAINT_CATEGORIES.includes(c) ? "paint" : GYPSUM_CATEGORIES.includes(c) ? "gypsum" : "other";
}
export const PURCHASE_UNITS = ["L", "kg", "piece", "sheet", "bar", "box", "roll", "bag", "pack", "m2", "m"] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

export type BrandRow = OrgRow & Upd & { name: string; is_active: boolean; families: ProductFamily[] };
export type EquivalenceGroupRow = OrgRow & Upd & {
  role: string;
  name: string;
  description: string | null;
  category: ProductCategory | null;
  purchase_unit: PurchaseUnit | null;
  coverage_per_unit: number | null;
  length_m: number | null;
  contents_per_pack: number | null;
  area_m2: number | null;
  colour_specific: boolean;
  waste_percent: number | null;
};
export type ProductRow = OrgRow & Upd & {
  brand_id: string | null;
  equivalence_group_id: string | null;
  name: string;
  category: ProductCategory;
  purchase_unit: PurchaseUnit;
  ref_pack_size: number | null;
  coverage_per_pack: number | null;
  surface_factor: number;
  length_m: number | null;
  contents_per_pack: number | null;
  area_m2: number | null;
  colour_specific: boolean;
  application: "interior" | "exterior" | "both";
  sheen: string | null;
  specs: Json;
  waste_percent: number | null;
  show_on_quote: boolean;
  datasheet_path: string | null;
  notes: string | null;
  is_active: boolean;
  legacy_material_id: string | null;
  coverage_per_unit: number | null;
};
export type ProductPackRow = OrgRow & { product_id: string; size: number; label: string | null };
export type ProductPriceRow = OrgRow & {
  product_id: string;
  pack_id: string | null;
  supplier_id: string | null;
  unit_price: number;
  effective_from: string;
  source: string | null;
};
export type ProductCurrentPriceRow = {
  product_id: string;
  pack_id: string | null;
  supplier_id: string | null;
  organization_id: string;
  unit_price: number;
  effective_from: string;
};
export type SystemKind = "gypsum_ceiling" | "gypsum_partition" | "interior_paint" | "exterior_paint";
export type SystemRow = OrgRow & Upd & {
  service_id: string | null;
  code: string;
  kind: SystemKind;
  name: string;
  spec_text: string | null;
  params: Json;
  is_active: boolean;
  sort_order: number;
};
export type SystemVariantRow = OrgRow & Upd & {
  system_id: string;
  code: string;
  name: string;
  params: Json;
  spec_text: string | null;
  is_default: boolean;
  sort_order: number;
};
export type SystemComponentRow = OrgRow & Upd & {
  system_id: string;
  role: string;
  equivalence_group_id: string | null;
  product_id: string | null;
  coats: number | null;
  formula: string | null;
  sort_order: number;
  inclusion: "always" | "on" | "off";
  variant_codes: string[] | null;
};
export type RateSection = "gypsum" | "interior" | "exterior" | "labour" | "commercial";
export type ConsumptionRateRow = OrgRow & Upd & {
  key: string;
  value: number;
  unit: string | null;
  label: string;
  section: RateSection;
  sort_order: number;
  last_reviewed_at: string | null;
};

export type PricingTemplateRow = OrgRow & Upd & { service: "gypsum" | "interior" | "exterior"; data: Json };


export type ClientRow = OrgRow & Upd & {
  number: string;
  name: string;
  phone: string | null;
  city: string | null;
  district: string | null;
  id_number: string | null;
  location_url: string | null;
  notes: string | null;
  is_active: boolean;
};
export type SurveyRow = OrgRow & Upd & {
  number: string;
  client_id: string;
  title: string | null;
  mode: "total" | "rooms";
  visit_date: string | null;
  totals: Json;
  notes: string | null;
};
export type SurveyRoomRow = OrgRow & Upd & {
  survey_id: string;
  name: string;
  unit_label: string | null;
  length_m: number;
  width_m: number;
  height_m: number;
  openings_m2: number;
  gypsum_ceiling: boolean;
  ceiling_board: "normal" | "moisture" | "fire";
  paint_walls: boolean;
  paint_ceiling: boolean;
  wall_zone: "normal" | "wet" | "decorative";
  sort_order: number;
};
export type QuoteStatus = "draft" | "pending_approval" | "issued" | "accepted" | "rejected" | "expired";
export type QuoteOption = { version: number; label: string };
export type QuoteRow = OrgRow & Upd & {
  number: string;
  /** 2–3 versions offered side by side (null = a single quote) */
  options?: QuoteOption[] | null;
  client_id: string;
  survey_id: string | null;
  service: "gypsum" | "interior" | "exterior";
  title: string | null;
  status: QuoteStatus;
  current_version: number;
  valid_until: string | null;
};
export type QuoteVersionRow = OrgRow & {
  quote_id: string;
  version: number;
  selection: Json;
  quantities: Json;
  client_view: Json;
  pricing_method: "unit" | "lump";
  estimated: boolean;
  discount: number;
  subtotal: number;
  vat_percent: number;
  vat: number;
  total: number;
  notes: string | null;
  /** unpriced items when saved (issue_quote refuses a version with any) */
  problems: number;
};
export type QuoteVersionCostRow = {
  quote_version_id: string;
  organization_id: string;
  cost: number;
  cost_with_contingency: number;
  margin_percent: number;
  lines: Json;
  purchase_list: Json;
  created_at: string;
  created_by: string | null;
};
export type ApprovalRow = OrgRow & Upd & {
  kind: "quote_margin" | "quote_discount" | "purchase_limit" | "addendum";
  entity: "quote" | "purchase" | "addendum";
  entity_id: string;
  details: Json;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
};


export type ContractStatus = "draft" | "sent" | "accepted" | "cancelled";
export type ContractRow = OrgRow & Upd & {
  number: string;
  /** copied from the quote; the client picks one while accepting */
  options?: QuoteOption[] | null;
  /** editable clauses (ContractTermsConfig), frozen after acceptance */
  terms?: Json;
  quote_id: string;
  quote_version: number;
  client_id: string;
  service: "gypsum" | "interior" | "exterior";
  project_type: "full" | "labour" | "supply";
  start_date: string;
  duration_days: number;
  warranty_months: number;
  total: number;
  status: ContractStatus;
  notes: string | null;
  accepted_at: string | null;
  accepted_name: string | null;
  accepted_ip: string | null;
  accepted_user_agent: string | null;
  accepted_signature: string | null;
};
export type ContractPaymentRow = OrgRow & Upd & {
  contract_id: string;
  seq: number;
  label: string;
  percent: number;
  amount: number;
  due_event: "signing" | "material_supply" | "board_closing" | "primer_done" | "handover" | "custom";
  status: "pending" | "requested" | "paid";
  paid_at: string | null;
  expected_date: string | null;
  requested_at: string | null;
  paid_amount: number | null;
  paid_method: "transfer" | "cash" | "cheque" | "card" | null;
  paid_reference: string | null;
};
export type PortalLinkRow = OrgRow & {
  contract_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
  open_count: number;
};

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type TeamRow = OrgRow & Upd & {
  name: string;
  kind: "inhouse" | "external";
  services: ("gypsum" | "interior" | "exterior")[];
  color: string;
  contact_phone: string | null;
  is_active: boolean;
  subcontractor_id?: string | null;
  notes: string | null;
};
export type TeamMemberRow = OrgRow & { team_id: string; employee_id: string };
export type ScheduleEntryRow = OrgRow & Upd & {
  team_id: string;
  contract_id: string | null;
  kind: "work" | "leave" | "other";
  title: string | null;
  start_date: string;
  end_date: string;
  notes: string | null;
};

export type InventoryItemRow = OrgRow & Upd & { name: string; unit: string; product_id: string | null; is_general: boolean };
export type PurchaseStatus = "draft" | "pending_approval" | "recorded" | "rejected" | "cancelled";
export type PurchaseRow = OrgRow & Upd & {
  number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_vat: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  contract_id: string | null;
  status: PurchaseStatus;
  subtotal: number;
  vat: number;
  total: number;
  attachment_path: string | null;
  ai_extracted: boolean;
  ai_flags: Json;
  notes: string | null;
  recorded_at: string | null;
  addendum_id: string | null;
  /** supplier paid (set only by record_purchase_payment) */
  paid_on?: string | null;
  paid_from?: "bank" | "cash" | null;
  paid_reference?: string | null;
};
export type PurchaseLineRow = OrgRow & {
  purchase_id: string;
  seq: number;
  kind: "material" | "expense";
  item_id: string | null;
  description: string;
  colour: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
};
export type InventoryMovementRow = OrgRow & {
  item_id: string;
  contract_id: string | null;
  kind: "purchase" | "issue" | "return" | "transfer" | "adjust";
  quantity: number;
  unit_cost: number;
  purchase_line_id: string | null;
  transfer_group: string | null;
  note: string | null;
};

export type StageStatus = "pending" | "in_progress" | "awaiting_client" | "confirmed";
export type ProjectStageRow = OrgRow & Upd & {
  contract_id: string;
  addendum_id: string | null;
  seq: number;
  name: string;
  payment_event: string | null;
  is_final: boolean;
  status: StageStatus;
  progress: number;
  report: string | null;
  report_ai: boolean;
  sent_at: string | null;
  confirmed_at: string | null;
  confirmed_name: string | null;
  confirmed_ip: string | null;
  confirmed_user_agent: string | null;
  confirmed_signature: string | null;
};
export type SiteVisitRow = OrgRow & { contract_id: string; latitude: number | null; longitude: number | null; accuracy_m: number | null; note: string | null; checked_in_at: string };
export type ProgressUpdateRow = OrgRow & { contract_id: string; stage_id: string; progress: number; note: string | null; photos: string[]; visible_to_client: boolean };
export type ClientNoteRow = OrgRow & Upd & { contract_id: string; stage_id: string | null; body: string; photos: string[]; status: "new" | "seen" | "resolved"; reply: string | null };

export type AddendumStatus = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "rejected" | "cancelled";
export type AddendumRow = OrgRow & Upd & {
  number: string;
  contract_id: string;
  title: string;
  description: string;
  amount: number;
  vat_percent: number;
  vat: number;
  total: number;
  extra_days: number;
  status: AddendumStatus;
  payment_status: "pending" | "requested" | "paid";
  accepted_at: string | null;
  accepted_name: string | null;
  accepted_ip: string | null;
  accepted_user_agent: string | null;
  accepted_signature: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  /** set only by record_addendum_payment */
  paid_method: "transfer" | "cash" | "cheque" | "card" | null;
  paid_reference: string | null;
};
export type SubcontractorRow = OrgRow & Upd & {
  name: string;
  phone: string | null;
  services: ("gypsum" | "interior" | "exterior")[];
  vat_number: string | null;
  iban: string | null;
  notes: string | null;
  is_active: boolean;
};
export type SubAgreementRow = OrgRow & Upd & {
  subcontractor_id: string;
  /** an accepted addendum grew the project: review this agreement (cleared by any staff edit) */
  review_addendum_id?: string | null;
  contract_id: string;
  scope: string;
  basis: "lump" | "per_m2";
  rate: number;
  quantity_m2: number | null;
  schedule: "weekly" | "progress";
  status: "active" | "closed";
  auto_progress: boolean;
};
export type SubWorkRow = OrgRow & { agreement_id: string; work_date: string; quantity_m2: number | null; percent: number | null; amount: number; note: string | null; auto: boolean };
export type SubPaymentRow = OrgRow & { agreement_id: string; paid_on: string; amount: number; method: "transfer" | "cash" | "cheque"; reference: string | null; note: string | null };
export type PettyAccountRow = OrgRow & Upd & { holder_id: string; name: string; is_active: boolean };
export type PettyEntryRow = OrgRow & {
  account_id: string;
  kind: "topup" | "expense" | "return";
  entry_date: string;
  amount: number;
  contract_id: string | null;
  description: string;
  supplier_name: string | null;
  attachment_path: string | null;
  ai_extracted: boolean;
};

export type FinanceSettingsRow = { organization_id: string; cash_balance: number; cash_balance_on: string; payday: number; created_at: string; created_by: string | null; updated_at: string };

export type EmployeeAdvanceRow = OrgRow & { employee_id: string; given_on: string; amount: number; note: string | null; deducted_in_run: string | null; /** settled by payroll runs so far (set by approve_payroll_run) */ deducted_amount: number };
export type PayrollRunRow = OrgRow & Upd & { month: string; status: "draft" | "approved" | "paid"; approved_at: string | null; approved_by: string | null; paid_on: string | null };
export type PayrollLineRow = OrgRow & Upd & {
  run_id: string;
  employee_id: string;
  full_name: string;
  iban: string | null;
  basic: number;
  housing: number;
  transport: number;
  other: number;
  overtime: number;
  deductions: number;
  advances: number;
  net: number;
  note: string | null;
};

export type NotificationKind = "approval" | "client_note" | "stage_confirmed" | "contract_accepted" | "addendum_accepted" | "payment_received" | "payment_late" | "doc_expiry" | "approval_reminder" | "maintenance_request"
  | "project_delay" | "project_over_budget" | "project_losing" | "missed_visit" | "agreement_review";
export type NotificationRow = { id: string; organization_id: string; user_id: string; kind: NotificationKind; params: Json; link: string | null; dedupe_key: string | null; read_at: string | null; created_at: string };
export type NotificationPrefRow = { organization_id: string; user_id: string; kind: NotificationKind; in_app: boolean; whatsapp: boolean; push: boolean; updated_at: string };
export type PushSubscriptionRow = { id: string; organization_id: string; user_id: string; endpoint: string; p256dh: string; auth: string; device: string | null; failures: number; last_success_at: string | null; created_at: string; created_by: string | null };
export type NotificationDeliveryRow = { id: string; notification_id: string; organization_id: string; channel: "whatsapp" | "push"; phone: string | null; user_id: string | null; status: "queued" | "sent" | "failed"; attempts: number; last_error: string | null; sent_at: string | null; created_at: string };

export type InvoiceParty = { name: string | null; legal_name?: string | null; cr_number?: string | null; vat_number?: string | null; id_number?: string | null; address?: string | null; city?: string | null; district?: string | null; phone?: string | null };
export type InvoiceRow = {
  id: string; organization_id: string; number: string; contract_id: string; payment_id: string | null; addendum_id: string | null; kind: "tax" | "simple";
  issue_date: string; due_date: string; description: string; seller: InvoiceParty; buyer: InvoiceParty; subtotal: number; vat_percent: number; vat: number; total: number;
  created_at: string; created_by: string | null;
};
export type ClientReceiptRow = {
  id: string; organization_id: string; number: string; contract_id: string; payment_id: string | null; addendum_id: string | null; label: string; amount: number;
  paid_on: string; method: "transfer" | "cash" | "cheque" | "card" | null; reference: string | null; created_at: string; created_by: string | null;
};
export type MaintenanceStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";
export type MaintenanceRow = {
  id: string; organization_id: string; number: string; contract_id: string; body: string; photos: string[]; source: "client" | "staff"; status: MaintenanceStatus;
  assigned_to: string | null; covered: boolean; cost: number; reply: string | null; internal_note: string | null; resolved_at: string | null; closed_at: string | null;
  /** the staff member who closed / rejected it (set by the database); null = open or closed by the client */
  closed_by: string | null;
  client_confirmed_at: string | null; created_at: string; created_by: string | null; updated_at: string;
};
export type ClientMessageRow = {
  id: string; organization_id: string; contract_id: string; phone: string; kind: "receipt" | "maintenance_done"; params: Json; status: "queued" | "sent" | "failed";
  attempts: number; last_error: string | null; sent_at: string | null; created_at: string;
};
export type QoyodSettingsRow = {
  organization_id: string; enabled: boolean; invoice_status: "Draft" | "Approved"; inventory_id: number | null; receive_account_id: number | null; expense_account_id: number | null;
  salary_account_id: number | null; cash_account_id: number | null; subcontract_account_id: number | null;
  service_products: Record<string, number>; addendum_product_id: number | null; sync_from: string | null; key_last4: string | null; key_set_at: string | null; updated_at: string; updated_by: string | null;
  /** the worker's last automatic setup run (service role only) */
  auto_setup_at: string | null;
};
export type AddendumCostRow = {
  addendum_id: string; organization_id: string; contract_id: string; material_cost: number; other_cost: number;
  created_at: string; created_by: string | null; updated_at: string;
};
export type QoyodJobKind = "customer" | "vendor" | "invoice" | "invoice_payment" | "bill" | "bill_payment" | "payroll" | "transfer";
export type QoyodJobRow = {
  id: string; organization_id: string; kind: QoyodJobKind; entity_type: "client" | "supplier" | "subcontractor" | "contract_payment" | "addendum" | "purchase" | "payroll_run" | "subcontractor_payment" | "petty_cash" | "petty_cash_opening"; entity_id: string; ref: string;
  amount: number | null; status: "queued" | "running" | "done" | "failed"; attempts: number; next_attempt_at: string; last_error: string | null; qoyod_id: number | null; done_at: string | null; created_at: string; updated_at: string;
  /** petty-cash jobs only: the account fixed when queued */
  route: "bank" | "cash" | null;
  /** petty cash routed "cash": the cash account it posts to; reconcile jobs: from / to (null = the bank) */
  cash_account_id: number | null; from_account_id: number | null; to_account_id: number | null;
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
      brands: Table<BrandRow>;
      equivalence_groups: Table<EquivalenceGroupRow>;
      products: Table<ProductRow>;
      product_packs: Table<ProductPackRow>;
      product_prices: Table<ProductPriceRow>;
      systems: Table<SystemRow>;
      system_variants: Table<SystemVariantRow>;
      system_components: Table<SystemComponentRow>;
      consumption_rates: Table<ConsumptionRateRow>;
      pricing_templates: Table<PricingTemplateRow>;
      clients: Table<ClientRow>;
      surveys: Table<SurveyRow>;
      survey_rooms: Table<SurveyRoomRow>;
      quotes: Table<QuoteRow>;
      quote_versions: Table<QuoteVersionRow>;
      quote_version_costs: Table<QuoteVersionCostRow>;
      approvals: Table<ApprovalRow>;
      contracts: Table<ContractRow>;
      contract_payments: Table<ContractPaymentRow>;
      client_portal_links: Table<PortalLinkRow>;
      teams: Table<TeamRow>;
      team_members: Table<TeamMemberRow>;
      schedule_entries: Table<ScheduleEntryRow>;
      inventory_items: Table<InventoryItemRow>;
      purchases: Table<PurchaseRow>;
      purchase_lines: Table<PurchaseLineRow>;
      inventory_movements: Table<InventoryMovementRow>;
      project_stages: Table<ProjectStageRow>;
      site_visits: Table<SiteVisitRow>;
      progress_updates: Table<ProgressUpdateRow>;
      client_notes: Table<ClientNoteRow>;
      addenda: Table<AddendumRow>;
      subcontractors: Table<SubcontractorRow>;
      subcontractor_agreements: Table<SubAgreementRow>;
      subcontractor_work: Table<SubWorkRow>;
      subcontractor_payments: Table<SubPaymentRow>;
      petty_cash_accounts: Table<PettyAccountRow>;
      petty_cash_entries: Table<PettyEntryRow>;
      finance_settings: Table<FinanceSettingsRow>;
      employee_advances: Table<EmployeeAdvanceRow>;
      payroll_runs: Table<PayrollRunRow>;
      payroll_lines: Table<PayrollLineRow>;
      notifications: Table<NotificationRow>;
      notification_preferences: Table<NotificationPrefRow>;
      notification_deliveries: Table<NotificationDeliveryRow>;
      push_subscriptions: Table<PushSubscriptionRow>;
      project_members: Table<{ organization_id: string; contract_id: string; user_id: string; created_at: string; created_by: string | null }>;
      qoyod_settings: Table<QoyodSettingsRow>;
      client_receipts: Table<ClientReceiptRow>;
      invoices: Table<InvoiceRow>;
      contract_templates: Table<{ organization_id: string; terms: Json; updated_at: string; updated_by: string | null }>;
      maintenance_requests: Table<MaintenanceRow>;
      client_messages: Table<ClientMessageRow>;
      qoyod_sync_jobs: Table<QoyodJobRow>;
      addendum_costs: Table<AddendumCostRow>;
    };
    Views: {
      material_current_prices: { Row: MaterialCurrentPriceRow; Relationships: [] };
      material_supplier_prices: { Row: MaterialCurrentPriceRow; Relationships: [] };
      product_current_prices: { Row: ProductCurrentPriceRow; Relationships: [] };
    };
    Functions: {
      create_organization: { Args: { p_name: string }; Returns: string };
      can_create_organization: { Args: Record<string, never>; Returns: boolean };
      accept_pending_invitations: { Args: Record<string, never>; Returns: number };
      my_permissions: { Args: { p_org: string }; Returns: string[] };
      auth_phone_allowed: { Args: { p_phone: string }; Returns: boolean };
      check_rate_limit: { Args: { p_key: string; p_max: number; p_window_seconds: number }; Returns: boolean };
      seed_starter_catalogue: { Args: { p_org: string }; Returns: number };
      run_daily_reminders: { Args: Record<string, never>; Returns: number };
      record_purchase_payment: { Args: { p_purchase: string; p_date: string; p_from: "bank" | "cash"; p_reference?: string | null }; Returns: undefined };
      auth_hook_secret: { Args: { p_name: string }; Returns: string | null };
      qoyod_defer_job: { Args: { p_job: string; p_minutes: number; p_reason: string }; Returns: undefined };
      push_vapid_keys: { Args: { p_public?: string | null; p_private?: string | null }; Returns: Json };
      qoyod_set_key: { Args: { p_org: string; p_key: string }; Returns: undefined };
      qoyod_api_key: { Args: { p_org: string }; Returns: string | null };
      qoyod_backfill: { Args: { p_org: string; p_from: string }; Returns: number };
      qoyod_claim_jobs: { Args: { p_limit: number }; Returns: QoyodJobRow[] };
      qoyod_retry: { Args: { p_org: string; p_job?: string | null }; Returns: number };
      portal_warranty: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_add_maintenance: { Args: { p_number: string; p_token: string; p_body: string; p_photos: string[] }; Returns: string | null };
      portal_confirm_maintenance: { Args: { p_number: string; p_token: string; p_request: string }; Returns: boolean };
      contract_warranties: { Args: { p_org: string }; Returns: { contract_id: string; number: string; client_name: string; handover_at: string | null; warranty_end: string | null }[] };
      portal_contract_terms: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_invoice_docs: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_receipts: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_invoices: { Args: { p_number: string; p_token: string }; Returns: Json };
      create_payroll_run: { Args: { p_org: string; p_month: string }; Returns: string };
      approve_payroll_run: { Args: { p_run: string }; Returns: undefined };
      mark_payroll_paid: { Args: { p_run: string; p_paid_on: string }; Returns: undefined };
      record_client_payment: { Args: { p_payment: string; p_paid_on: string; p_amount: number; p_method: string; p_reference: string | null }; Returns: string };
      save_contract_schedule: {
        Args: { p_contract: string; p_start: string; p_duration: number; p_warranty: number; p_notes: string | null; p_payments: { label: string; percent: number; due_event: string }[] };
        Returns: undefined;
      };
      claim_push_subscription: { Args: { p_org: string; p_endpoint: string; p_p256dh: string; p_auth: string; p_device: string | null }; Returns: string };
      record_addendum_payment: { Args: { p_addendum: string; p_paid_on: string; p_amount: number; p_method: string; p_reference: string | null }; Returns: string };
      request_contract_payment: { Args: { p_payment: string }; Returns: undefined };
      requestable_payments: { Args: { p_org: string; p_contract?: string | null }; Returns: { payment_id: string }[] };
      save_quote_version: { Args: { p_user: string; p_quote: string; p_payload: Json }; Returns: { id: string; version: number }[] };
      qoyod_wake_waiting: { Args: { p_org: string }; Returns: number };
      issue_portal_link: { Args: { p_contract: string; p_token_hash: string; p_expires: string }; Returns: string };
      issue_quote: { Args: { p_quote: string; p_valid_until: string | null }; Returns: undefined };
      project_labour_costs: { Args: { p_org: string }; Returns: { contract_id: string; labour: number }[] };
      team_cost_month: { Args: { p_org: string }; Returns: { monthly: number; allocated: number; to_date: number }[] };
      submit_addendum: { Args: { p_id: string }; Returns: string };
      portal_addenda: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_accept_addendum: { Args: { p_number: string; p_token: string; p_addendum: string; p_name: string; p_signature: string | null; p_ip: string; p_user_agent: string }; Returns: boolean };
      portal_execution: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_confirm_stage: { Args: { p_number: string; p_token: string; p_stage: string; p_name: string; p_signature: string | null; p_ip: string; p_user_agent: string }; Returns: boolean };
      portal_add_note: { Args: { p_number: string; p_token: string; p_stage: string | null; p_body: string; p_photos: string[] }; Returns: string | null };
      submit_purchase: { Args: { p_id: string }; Returns: string };
      move_stock: { Args: { p_item: string; p_quantity: number; p_from: string | null; p_to: string | null; p_note?: string | null }; Returns: string };
      schedule_roster: { Args: { p_org: string }; Returns: { id: string; full_name: string; job_title: string | null }[] };
      portal_view: { Args: { p_number: string; p_token: string }; Returns: Json };
      portal_accept: { Args: { p_number: string; p_token: string; p_name: string; p_signature: string | null; p_ip: string; p_user_agent: string; p_version?: number | null }; Returns: boolean };
      portal_options: { Args: { p_number: string; p_token: string }; Returns: Json };
      seed_pricing_engine: { Args: { p_org: string }; Returns: { products: number; rates: number } };
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
