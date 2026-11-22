import type { ServiceSummary } from "@/components/catalogue/services-view";
import type { MaterialItem } from "@/components/catalogue/materials-view";
import type { RecipeLine, Spec, Stage } from "@/components/catalogue/service-detail-view";
import type { Employee } from "@/components/team/employees-view";
import type { CostItemRow } from "@/components/team/cost-items-view";

/** Illustrative sample data for the design preview only. */
export const SAMPLE_MATERIALS: MaterialItem[] = [
  { id: "m1", name_ar: "لوح جبس عادي 12.5مم", name_en: null, category: "جبس", unit: "sheet", scope: "general", sku: null, is_active: true, price: 23, priceSince: "2026-11-10", history: [{ unit_price: 23, effective_from: "2026-11-10", source: "مورد الرياض" }, { unit_price: 21.5, effective_from: "2026-08-01", source: null }] },
  { id: "m2", name_ar: "قطاع أوميغا", name_en: null, category: "جبس", unit: "piece", scope: "general", sku: null, is_active: true, price: 6.5, priceSince: "2026-10-02", history: [{ unit_price: 6.5, effective_from: "2026-10-02", source: null }] },
  { id: "m3", name_ar: "شريط فواصل", name_en: null, category: "جبس", unit: "roll", scope: "general", sku: null, is_active: true, price: 12, priceSince: "2026-09-15", history: [{ unit_price: 12, effective_from: "2026-09-15", source: null }] },
  { id: "m4", name_ar: "معجون جاهز", name_en: null, category: "دهانات", unit: "bucket", scope: "general", sku: null, is_active: true, price: null, priceSince: null, history: [] },
  { id: "m5", name_ar: "دهان داخلي — لون العميل", name_en: null, category: "دهانات", unit: "gallon", scope: "project", sku: null, is_active: true, price: 85, priceSince: "2026-11-01", history: [{ unit_price: 85, effective_from: "2026-11-01", source: null }, { unit_price: 90, effective_from: "2026-06-01", source: null }] },
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
  { id: "r1", material_id: "m1", material_name: "لوح جبس عادي 12.5مم", material_unit: "sheet", qty_per_unit: 0.35, waste_percent: null, unit_price: 23 },
  { id: "r2", material_id: "m2", material_name: "قطاع أوميغا", material_unit: "piece", qty_per_unit: 1.2, waste_percent: null, unit_price: 6.5 },
  { id: "r3", material_id: "m3", material_name: "شريط فواصل", material_unit: "roll", qty_per_unit: 0.02, waste_percent: 0, unit_price: 12 },
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
