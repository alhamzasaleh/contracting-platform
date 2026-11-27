import type { MarketersData } from "@/lib/data/marketers";
import type { MarketerPortalData } from "@/lib/marketer-portal";

/** Design preview: success partners («شركاء النجاح») and their rewards. */
export const SAMPLE_MARKETERS: MarketersData = {
  orgName: "ملمس",
  canManage: true,
  canDelete: true,
  canPay: true,
  canSeeVouchers: true,
  links: { contracts: true, projects: true },
  marketers: [
    {
      id: "mk1", number: "MK-2026-001", name: "سعد بن فهد الدوسري", phone: "966500000777", commission_percent: 5, iban: "SA0380000000608010167519", notes: null, is_active: true,
      clients: [{ number: "CL-2026-004", name: "أبو محمد العتيبي" }, { number: "CL-2026-009", name: "شركة البناء المتقن" }],
      link: { created_at: "2026-11-20T09:00:00Z", expires_at: "2027-11-20T09:00:00Z" },
      usage: { quotes: 3, contracts: 3, rewards: 3 },
    },
    { id: "mk2", number: "MK-2026-002", name: "مكتب الإتقان العقاري", phone: "966511110000", commission_percent: 3, iban: null, notes: "يحيل عملاء الفلل الجديدة", is_active: true, clients: [], link: null, usage: { quotes: 0, contracts: 0, rewards: 0 } },
    { id: "mk3", number: "MK-2026-003", name: "فهد العنزي", phone: "0097150123456", commission_percent: 4, iban: null, notes: null, is_active: false, clients: [], link: null, usage: { quotes: 0, contracts: 0, rewards: 0 } },
  ],
  commissions: [
    { id: "k1", contract_id: "c1", contract: "C-2026-004", client: "أبو محمد العتيبي", marketer_id: "mk1", base: 46000, percent: 5, amount: 2300, paid: 0, status: "due", due_at: "2026-11-23T10:00:00Z", paid_at: null, created_at: "2026-11-01T10:00:00Z", voucher: null },
    { id: "k2", contract_id: "c2", contract: "C-2026-006", client: "شركة البناء المتقن", marketer_id: "mk1", base: 120000, percent: 5, amount: 6000, paid: 0, status: "expected", due_at: null, paid_at: null, created_at: "2026-11-10T10:00:00Z", voucher: null },
    {
      id: "k3", contract_id: "c3", contract: "C-2026-002", client: "أبو محمد العتيبي", marketer_id: "mk1", base: 18000, percent: 4, amount: 720, paid: 720, status: "paid", due_at: "2026-10-20T10:00:00Z", paid_at: "2026-10-22T10:00:00Z", created_at: "2026-09-10T10:00:00Z",
      voucher: { number: "PV-2026-001", paid_on: "2026-10-22", method: "transfer", reference: "TRX-5521" },
    },
    // raised by a signed measurement after it was paid: the rest waits for the settlement payment
    {
      id: "k4", contract_id: "c4", contract: "C-2026-003", client: "شركة البناء المتقن", marketer_id: "mk1", base: 5500, percent: 5, amount: 275, paid: 250, status: "expected", due_at: null, paid_at: "2026-11-20T10:00:00Z", created_at: "2026-10-01T10:00:00Z",
      voucher: { number: "PV-2026-002", paid_on: "2026-11-20", method: "transfer", reference: null },
      vouchers: [{ number: "PV-2026-002", paid_on: "2026-11-20", amount: 250 }],
    },
    // lowered by a signed measurement after it was paid: paid above the reward (finance decides)
    {
      id: "k5", contract_id: "c5", contract: "C-2026-008", client: "مؤسسة الريان", marketer_id: "mk1", base: 4500, percent: 5, amount: 225, paid: 250, status: "paid", due_at: "2026-11-10T10:00:00Z", paid_at: "2026-11-12T10:00:00Z", created_at: "2026-10-05T10:00:00Z",
      voucher: { number: "PV-2026-003", paid_on: "2026-11-12", method: "transfer", reference: null },
      vouchers: [{ number: "PV-2026-003", paid_on: "2026-11-12", amount: 250 }],
    },
  ],
};

export const SAMPLE_PARTNER_PAGE: MarketerPortalData = {
  org: { name: "ملمس", legal_name: "مؤسسة ملمس للمقاولات", phone: "966500000000", brand: { primary: "#B5653E" } },
  marketer: { number: "MK-2026-001", name: "سعد بن فهد الدوسري", commission_percent: 5 },
  expires_at: "2027-11-20T09:00:00Z",
  items: [
    { client: "أبو محمد العتيبي", contract: "C-2026-004", date: "2026-11-01T10:00:00Z", contract_status: "accepted", handed_over: true, base: 46000, percent: 5, amount: 2300, paid_amount: 0, status: "due", due_at: "2026-11-23T10:00:00Z", paid_at: null, vouchers: [] },
    { client: "شركة البناء المتقن", contract: "C-2026-006", date: "2026-11-10T10:00:00Z", contract_status: "accepted", handed_over: false, base: 120000, percent: 5, amount: 6000, paid_amount: 0, status: "expected", due_at: null, paid_at: null, vouchers: [] },
    { client: "أبو محمد العتيبي", contract: "C-2026-002", date: "2026-09-10T10:00:00Z", contract_status: "accepted", handed_over: true, base: 18000, percent: 4, amount: 720, paid_amount: 720, status: "paid", due_at: "2026-10-20T10:00:00Z", paid_at: "2026-10-22T10:00:00Z", vouchers: [{ number: "PV-2026-001", paid_on: "2026-10-22", amount: 720, method: "transfer" }] },
  ],
};

/** finance.view only (no marketers.manage): rewards and vouchers, no editing or page links */
export const SAMPLE_MARKETERS_FINANCE: MarketersData = { ...SAMPLE_MARKETERS, canManage: false, canDelete: false, canPay: false };
export const SAMPLE_MARKETERS_EMPTY: MarketersData = { ...SAMPLE_MARKETERS, marketers: [], commissions: [] };
export const SAMPLE_PARTNER_PAGE_EMPTY: MarketerPortalData = { ...SAMPLE_PARTNER_PAGE, items: [] };
