import type { PettyCashData, SubcontractorsData } from "@/lib/data/subcontractors";

const projects = [
  { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن" },
  { id: "k2", number: "C-2026-005", client: "فيلا الياسمين" },
];

export const SAMPLE_SUBS: SubcontractorsData = {
  canManage: true,
  canPay: true,
  projects,
  subs: [
    { id: "s1", name: "مؤسسة الإتقان للجبس", phone: "966551112222", services: ["gypsum"], iban: null, vat_number: null, notes: null, is_active: true },
    { id: "s2", name: "ورشة الألوان", phone: "966553334444", services: ["exterior"], iban: null, vat_number: null, notes: null, is_active: true },
  ],
  agreements: [
    {
      id: "g1", subcontractor_id: "s1", contract_id: "k0", scope: "تركيب أسقف الدور الأرضي", basis: "per_m2", rate: 15, quantity_m2: 400, schedule: "weekly", status: "active", auto_progress: false,
      work: [
        { id: "w1", work_date: "2026-11-21", quantity_m2: 120, percent: null, amount: 1800, note: null, auto: false },
        { id: "w2", work_date: "2026-11-22", quantity_m2: 160, percent: null, amount: 2400, note: null, auto: false },
      ],
      payments: [{ id: "p1", paid_on: "2026-11-22", amount: 1800, method: "transfer", reference: null }],
    },
    { id: "g2", subcontractor_id: "s2", contract_id: "k2", scope: "دهان الواجهات بالرش", basis: "lump", rate: 9000, quantity_m2: null, schedule: "progress", status: "active", auto_progress: true, review: "AD-2026-001", work: [{ id: "w3", work_date: "2026-11-10", quantity_m2: null, percent: 50, amount: 4500, note: "تلقائي من تقدم المشروع: 50%", auto: true }], payments: [] },
  ],
};

export const SAMPLE_PETTY: PettyCashData = {
  userId: "u1",
  canFinance: true,
  canManage: true,
  aiEnabled: true,
  projects,
  members: [{ id: "u1", name: "صالح العتيبي" }, { id: "u2", name: "أحمد (مشرف)" }],
  accounts: [{ id: "a1", name: "عهدة المشرف أحمد", holder_id: "u2", holder: "أحمد (مشرف)", is_active: true }],
  entries: [
    { id: "e3", account_id: "a1", kind: "expense", entry_date: "2026-11-22", amount: 85, contract_id: "k0", description: "شريط لاصق ونايلون حماية", supplier_name: "محل العمران", has_receipt: true, ai_extracted: true },
    { id: "e2", account_id: "a1", kind: "expense", entry_date: "2026-11-21", amount: 240, contract_id: "k0", description: "نقل ألواح بالونيت", supplier_name: null, has_receipt: true, ai_extracted: false },
    { id: "e1", account_id: "a1", kind: "topup", entry_date: "2026-11-20", amount: 1000, contract_id: null, description: "تعبئة أسبوعية", supplier_name: null, has_receipt: false, ai_extracted: false },
  ],
};
