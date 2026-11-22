import type { ServiceSummary } from "@/components/catalogue/services-view";
import type { MaterialItem } from "@/components/catalogue/materials-view";
import type { RecipeLine, Spec, Stage } from "@/components/catalogue/service-detail-view";
import type { Employee } from "@/components/team/employees-view";
import type { CostItemRow } from "@/components/team/cost-items-view";

/** Illustrative sample data for the design preview only. */
export const SAMPLE_SUPPLIERS = [
  { id: "sp1", name: "مؤسسة الدهانات الحديثة", contact_name: "أبو خالد", phone: "966551112233", vat_number: "310000000000003", city: "الرياض", notes: null, is_active: true },
  { id: "sp2", name: "مستودع مواد البناء", contact_name: null, phone: null, vat_number: null, city: "الرياض", notes: null, is_active: true },
];

const h = (unit_price: number, effective_from: string, supplier_name: string | null = null, source: string | null = null) => ({ unit_price, effective_from, source, supplier_name });

export const SAMPLE_MATERIALS: MaterialItem[] = [
  { id: "m1", name_ar: "لوح جبس عادي 12.5مم", name_en: null, category: "جبس", unit: "sheet", scope: "general", sku: null, brand: "كناوف", package_desc: "لوح 120×240", coverage_per_unit: 2.88, preferred_supplier_id: "sp2", preferred_supplier_name: "مستودع مواد البناء", is_active: true, price: 23, priceSince: "2026-11-10", supplierPrices: [{ supplier_id: "sp2", supplier_name: "مستودع مواد البناء", unit_price: 23, since: "2026-11-10" }], history: [h(23, "2026-11-10", "مستودع مواد البناء"), h(21.5, "2026-08-01")] },
  { id: "m2", name_ar: "قطاع أوميغا", name_en: null, category: "جبس", unit: "piece", scope: "general", sku: null, brand: null, package_desc: "طول 3م", coverage_per_unit: null, preferred_supplier_id: null, preferred_supplier_name: null, is_active: true, price: 6.5, priceSince: "2026-10-02", supplierPrices: [], history: [h(6.5, "2026-10-02")] },
  { id: "m3", name_ar: "شريط فواصل", name_en: null, category: "جبس", unit: "roll", scope: "general", sku: null, brand: null, package_desc: "لفة 90م", coverage_per_unit: null, preferred_supplier_id: null, preferred_supplier_name: null, is_active: true, price: 12, priceSince: "2026-09-15", supplierPrices: [], history: [h(12, "2026-09-15")] },
  { id: "m4", name_ar: "معجون جاهز", name_en: null, category: "دهانات", unit: "bucket", scope: "general", sku: null, brand: "الجزيرة", package_desc: "سطل 25 كجم", coverage_per_unit: 30, preferred_supplier_id: null, preferred_supplier_name: null, is_active: true, price: null, priceSince: null, supplierPrices: [], history: [] },
  { id: "m5", name_ar: "دهان داخلي مطفي", name_en: null, category: "دهانات", unit: "gallon", scope: "project", sku: null, brand: "جوتن", package_desc: "جالون 3.6 لتر", coverage_per_unit: 35, preferred_supplier_id: "sp1", preferred_supplier_name: "مؤسسة الدهانات الحديثة", is_active: true, price: 85, priceSince: "2026-11-01", supplierPrices: [{ supplier_id: "sp2", supplier_name: "مستودع مواد البناء", unit_price: 82, since: "2026-11-05" }, { supplier_id: "sp1", supplier_name: "مؤسسة الدهانات الحديثة", unit_price: 85, since: "2026-11-01" }], history: [h(82, "2026-11-05", "مستودع مواد البناء"), h(85, "2026-11-01", "مؤسسة الدهانات الحديثة"), h(90, "2026-06-01", "مؤسسة الدهانات الحديثة")] },
];

export const SAMPLE_SERVICES: ServiceSummary[] = [
  { id: "s1", code: "gypsum", name_ar: "أسقف وجدران جبس بورد", name_en: "Gypsum board ceilings & partitions", description: null, unit: "m2", waste_percent: 10, is_active: true, stages: 5, recipeLines: 3, costPerUnit: 18.4, missingPrices: 0 },
  { id: "s2", code: "interior-paint", name_ar: "دهانات داخلية", name_en: "Interior paint", description: null, unit: "m2", waste_percent: null, is_active: true, stages: 7, recipeLines: 2, costPerUnit: 6.2, missingPrices: 1 },
  { id: "s3", code: "exterior-paint", name_ar: "دهانات خارجية", name_en: "Exterior paint", description: null, unit: "m2", waste_percent: null, is_active: true, stages: 5, recipeLines: 0, costPerUnit: 0, missingPrices: 0 },
  { id: "s4", code: "plaster", name_ar: "لياسة", name_en: "Plaster", description: null, unit: "m2", waste_percent: null, is_active: true, stages: 5, recipeLines: 0, costPerUnit: 0, missingPrices: 0 },
  { id: "s5", code: "tiling", name_ar: "بلاط وسيراميك", name_en: "Tiling", description: null, unit: "m2", waste_percent: null, is_active: false, stages: 4, recipeLines: 0, costPerUnit: 0, missingPrices: 0 },
];

export const SAMPLE_STAGES: Stage[] = [
  { id: "t1", kind: "prep", name_ar: "تجهيز الموقع وتحديد المناسيب", productivity_per_day: null, fixed_days: 0.5, notes: null },
  { id: "t2", kind: "work", name_ar: "تركيب الهيكل المعدني", productivity_per_day: 60, fixed_days: 0, notes: null },
  { id: "t3", kind: "work", name_ar: "تركيب الألواح", productivity_per_day: 70, fixed_days: 0, notes: null },
  { id: "t4", kind: "work", name_ar: "معالجة الفواصل والمعجون", productivity_per_day: 50, fixed_days: 1, notes: null },
  { id: "t5", kind: "handover", name_ar: "التنظيف والتسليم", productivity_per_day: null, fixed_days: 0.5, notes: null },
];

export const SAMPLE_SPECS: Spec[] = [
  { id: "p1", title: "المواصفات القياسية", body: "معجون الفواصل وجهين، ووجه ثالث عند الحاجة. معالجة جميع الفواصل بالشريط. تسليم السطح جاهزاً للدهان.", is_default: true },
];

export const SAMPLE_RECIPE: RecipeLine[] = [
  { id: "r1", material_id: "m1", material_name: "لوح جبس عادي 12.5مم", material_unit: "sheet", material_brand: "كناوف", coverage_per_unit: 2.88, calc_mode: "coverage", coats: 1, qty_per_unit: null, waste_percent: null, unit_price: 23 },
  { id: "r2", material_id: "m2", material_name: "قطاع أوميغا", material_unit: "piece", material_brand: null, coverage_per_unit: null, calc_mode: "fixed", coats: 1, qty_per_unit: 1.2, waste_percent: null, unit_price: 6.5 },
  { id: "r3", material_id: "m3", material_name: "شريط فواصل", material_unit: "roll", material_brand: null, coverage_per_unit: null, calc_mode: "fixed", coats: 1, qty_per_unit: 0.02, waste_percent: 0, unit_price: 12 },
];

export const SAMPLE_COST_ITEMS: (CostItemRow & { name_ar: string })[] = [
  { id: "c1", code: "gosi_saudi", name_ar: "التأمينات الاجتماعية (حصة المنشأة) — سعودي", applies_to: "saudi", basis: "percent", value: 0, amortize_months: null, is_active: true, last_reviewed_at: null },
  { id: "c2", code: "gosi_non_saudi", name_ar: "التأمينات الاجتماعية (أخطار مهنية) — غير سعودي", applies_to: "non_saudi", basis: "percent", value: 2, amortize_months: null, is_active: true, last_reviewed_at: "2026-11-20" },
  { id: "c3", code: "medical_insurance", name_ar: "التأمين الطبي", applies_to: "all", basis: "annual", value: 1400, amortize_months: null, is_active: true, last_reviewed_at: "2026-11-20" },
  { id: "c4", code: "work_permit_levy", name_ar: "رخصة العمل والمقابل المالي", applies_to: "non_saudi", basis: "annual", value: 0, amortize_months: null, is_active: true, last_reviewed_at: null },
  { id: "c5", code: "recruitment", name_ar: "الاستقدام (تأشيرة، مكتب، تذكرة، فحص)", applies_to: "non_saudi", basis: "one_time", value: 0, amortize_months: 24, is_active: true, last_reviewed_at: null },
];

export const SAMPLE_EMPLOYEES: Employee[] = [
  { id: "e1", full_name: "رحيم الله خان", is_saudi: false, nationality: "باكستان", job_title: "دهّان", phone: null, id_number: null, id_expiry: new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10), passport_expiry: null, insurance_expiry: null, start_date: null, basic_salary: 1600, housing_allowance: 0, transport_allowance: 0, other_allowances: 200, iban: null, status: "active", notes: null },
  { id: "e2", full_name: "محمد القحطاني", is_saudi: true, nationality: null, job_title: "مشرف", phone: null, id_number: null, id_expiry: null, passport_expiry: null, insurance_expiry: null, start_date: null, basic_salary: 6000, housing_allowance: 1500, transport_allowance: 500, other_allowances: 0, iban: null, status: "active", notes: null },
  { id: "e3", full_name: "أنور حسين", is_saudi: false, nationality: "بنغلاديش", job_title: "فني جبس", phone: null, id_number: null, id_expiry: null, passport_expiry: null, insurance_expiry: null, start_date: null, basic_salary: 1800, housing_allowance: 0, transport_allowance: 0, other_allowances: 0, iban: null, status: "on_leave", notes: null },
];
