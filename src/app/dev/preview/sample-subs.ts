import type { PettyCashData, SubcontractorsData } from "@/lib/data/subcontractors";

const projects = [
  { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن" },
  { id: "k2", number: "C-2026-005", client: "فيلا الياسمين" },
];

export const SAMPLE_SUBS: SubcontractorsData = {
  canManage: true,
  canPay: true,
  canSeeVouchers: true,
  links: [{ subcontractor_id: "s1", created_at: "2026-11-20T10:00:00Z", expires_at: "2027-11-20T10:00:00Z" }],
  projects,
  subs: [
    { id: "s1", number: "SC-2026-001", name: "مؤسسة الإتقان للجبس", phone: "966551112222", services: ["gypsum"], iban: null, vat_number: null, notes: null, is_active: true },
    { id: "s2", number: "SC-2026-002", name: "ورشة الألوان", phone: "966553334444", services: ["exterior"], iban: null, vat_number: null, notes: null, is_active: true },
  ],
  agreements: [
    {
      id: "g1", subcontractor_id: "s1", contract_id: "k0", scope: "تركيب أسقف الدور الأرضي", basis: "per_m2", rate: 15, quantity_m2: 400, schedule: "weekly", status: "active", auto_progress: false,
      work: [
        { id: "w1", work_date: "2026-11-21", quantity_m2: 120, percent: null, amount: 1800, note: null, auto: false },
        { id: "w2", work_date: "2026-11-22", quantity_m2: 160, percent: null, amount: 2400, note: null, auto: false },
      ],
      payments: [{ id: "p1", number: "SP-2026-001", paid_on: "2026-11-22", amount: 1800, method: "transfer", reference: null }],
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
  members: [{ id: "u1", name: "صالح العتيبي" }, { id: "u2", name: "أحمد سالم · مشرف" }],
  accounts: [{ id: "a1", name: "عهدة المشرف أحمد", holder_id: "u2", holder: "أحمد سالم · مشرف", is_active: true }],
  entries: [
    { id: "e3", account_id: "a1", kind: "expense", entry_date: "2026-11-22", amount: 85, contract_id: "k0", description: "شريط لاصق ونايلون حماية", supplier_name: "محل العمران", has_receipt: true, ai_extracted: true },
    { id: "e2", account_id: "a1", kind: "expense", entry_date: "2026-11-21", amount: 240, contract_id: "k0", description: "نقل ألواح بالونيت", supplier_name: null, has_receipt: true, ai_extracted: false },
    { id: "e1", account_id: "a1", kind: "topup", entry_date: "2026-11-20", amount: 1000, contract_id: null, description: "تعبئة أسبوعية", supplier_name: null, has_receipt: false, ai_extracted: false },
  ],
};

// --- the subcontractor's account (statement, voucher, his own page) ---------------------
import type { SubStatementDoc, SubVoucherDoc } from "@/lib/data/subcontractors";
import type { SubPortalData } from "@/lib/sub-portal";
import { subStatement } from "@/lib/subcontractors/statement";

const subAgreements = [{ id: "g1", contract: "C-2026-003", client: "شركة البناء المتقن", scope: "تركيب أسقف الدور الأرضي" }];
const subWork = SAMPLE_SUBS.agreements[0].work.map((w) => ({ ...w, agreement_id: "g1" }));
const subPays = SAMPLE_SUBS.agreements[0].payments.map((p) => ({ ...p, agreement_id: "g1" }));

export const SAMPLE_SUB_STATEMENT: SubStatementDoc = {
  sub: { number: "SC-2026-001", name: "مؤسسة الإتقان للجبس", phone: "966551112222", iban: "SA0380000000608010167519", vat_number: null },
  statement: subStatement(subAgreements, subWork, subPays),
  agreements: [{ contract: "C-2026-003", client: "شركة البناء المتقن", scope: "تركيب أسقف الدور الأرضي", agreed: 6000, earned: 4200, paid: 1800 }],
  today: "2026-11-25",
};

export const SAMPLE_SUB_VOUCHER: SubVoucherDoc = {
  voucher: { number: "SP-2026-001", paid_on: "2026-11-22", amount: 1800, method: "transfer", reference: "TRX-7781", note: null },
  sub: { number: "SC-2026-001", name: "مؤسسة الإتقان للجبس", iban: "SA0380000000608010167519" },
  agreement: { contract: "C-2026-003", client: "شركة البناء المتقن", scope: "تركيب أسقف الدور الأرضي" },
};

export const SAMPLE_SUB_PAGE: SubPortalData = {
  org: { name: "مؤسسة ملمس", legal_name: null, phone: "966500000000", brand: { primary: "#B5653E" } },
  subcontractor: { number: "SC-2026-001", name: "مؤسسة الإتقان للجبس" },
  expires_at: "2027-11-20T10:00:00Z",
  agreements: [{
    id: "g1", contract: "C-2026-003", client: "شركة البناء المتقن", city: "الرياض", district: "النرجس", scope: "تركيب أسقف الدور الأرضي", basis: "per_m2", rate: 15, quantity_m2: 400,
    schedule: "weekly", status: "active", created_at: "2026-11-20T10:00:00Z",
    work: subWork.map(({ work_date, quantity_m2, percent, amount, note }) => ({ work_date, quantity_m2, percent, amount, note })),
    payments: subPays.map(({ number, paid_on, amount, method }) => ({ number, paid_on, amount, method })),
  }],
  statement: subStatement(subAgreements, subWork, subPays),
};
