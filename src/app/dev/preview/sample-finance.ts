import type { OwnerFinance, PaymentRow } from "@/lib/data/finance";
import { weeklyForecast } from "@/lib/finance";

const today = "2026-11-23";
const payments: PaymentRow[] = [
  { id: "p1", contract_id: "k0", contract: "C-2026-003", client: "شركة البناء المتقن", seq: 1, label: "عند توقيع العقد", amount: 12000, paid: 12000, outstanding: 0, status: "paid", requested_at: "2026-11-19T10:00:00Z", expected: today, paid_at: "2026-11-19", late: false },
  { id: "p2", contract_id: "k0", contract: "C-2026-003", client: "شركة البناء المتقن", seq: 2, label: "بعد تقفيل الألواح", amount: 9000, paid: 0, outstanding: 9000, status: "requested", requested_at: "2026-11-10T10:00:00Z", expected: today, paid_at: null, late: true, client_phone: "966551234567" },
  { id: "p3", contract_id: "k0", contract: "C-2026-003", client: "شركة البناء المتقن", seq: 3, label: "عند التسليم النهائي", amount: 9000, paid: 0, outstanding: 9000, status: "pending", requested_at: null, expected: "2026-12-05", paid_at: null, late: false, due_event: "handover" },
  { id: "p6", contract_id: "k2", contract: "C-2026-005", client: "فيلا الياسمين", seq: 2, label: "بعد توريد المواد", amount: 4000, paid: 0, outstanding: 4000, status: "pending", requested_at: null, expected: "2026-11-28", paid_at: null, late: false, due_event: "material_supply", requestable: true },
  { id: "p4", contract_id: "k2", contract: "C-2026-005", client: "فيلا الياسمين", seq: 1, label: "عند توقيع العقد", amount: 8000, paid: 5000, outstanding: 3000, status: "requested", requested_at: "2026-11-20T10:00:00Z", expected: today, paid_at: "2026-11-21", late: false, client_phone: "966551234568" },
  { id: "p5", contract_id: "k2", contract: "C-2026-005", client: "فيلا الياسمين", seq: 2, label: "عند التسليم النهائي", amount: 12000, paid: 0, outstanding: 12000, status: "pending", requested_at: null, expected: "2026-12-26", paid_at: null, late: false },
];
const inflows = payments.filter((p) => p.outstanding > 0).map((p) => ({ date: p.expected, amount: p.outstanding, label: `${p.client} · ${p.label}`, kind: "client" }));
const outflows = [
  { date: "2026-11-27", amount: 28500, label: "salaries", kind: "payroll" },
  { date: "2026-12-27", amount: 28500, label: "salaries", kind: "payroll" },
  { date: "2027-01-27", amount: 28500, label: "salaries", kind: "payroll" },
  { date: today, amount: 6900, label: "subcontractors", kind: "subcontractors" },
];

export const SAMPLE_FINANCE: OwnerFinance = {
  today,
  orgName: "مؤسسة ملمس",
  cash: { balance: 24000, on: today, payday: 27 },
  kpis: { outstanding: 12000, collectedMonth: 17000, dueSoon: 21000, activeProjects: 2, payroll: 28500 },
  forecast: weeklyForecast(24000, inflows, outflows, today, 12),
  receivables: [
    { client: "شركة البناء المتقن", outstanding: 9000, paid: 12000, total: 21000 },
    { client: "فيلا الياسمين", outstanding: 3000, paid: 5000, total: 8000 },
  ],
  ageing: { "0_30": 12000, "31_60": 0, "61_90": 0, "90_plus": 0 },
  payments,
  profits: [
    { id: "k0", number: "C-2026-003", client: "شركة البناء المتقن", service: "gypsum", revenue: 30000, estimatedCost: 21000, actualCost: 17050, expected: 9000, actual: 12950, expectedMargin: 30, actualMargin: 43.2, losing: false, progress: 52, month: "2026-11" },
    { id: "k2", number: "C-2026-005", client: "فيلا الياسمين", service: "exterior", revenue: 20000, estimatedCost: 14400, actualCost: 15800, expected: 5600, actual: 4200, expectedMargin: 28, actualMargin: 21, losing: false, progress: 100, month: "2026-11" },
    { id: "k1", number: "C-2026-004", client: "أبو محمد العتيبي", service: "interior", revenue: 16258, estimatedCost: 11700, actualCost: 4100, expected: 4558, actual: 12158, expectedMargin: 28, actualMargin: 74.8, losing: false, progress: 10, month: "2026-11" },
  ],
  delayed: [{ number: "C-2026-005", client: "فيلا الياسمين", due: "2026-11-11", days: 12, progress: 92 }],
  overBudget: [{ number: "C-2026-003", client: "شركة البناء المتقن", ratio: 1.09 }],
  approvals: [
    { id: "ap1", kind: "purchase_limit", entity: "purchase", entity_id: "x", details: { number: "PO-2026-003", total: 7245 }, created_at: "2026-11-22T10:00:00Z", link: "/purchases/detail" },
    { id: "ap2", kind: "quote_discount", entity: "quote", entity_id: "y", details: { number: "Q-2026-009", discountPercent: 7 }, created_at: "2026-11-22T12:00:00Z", link: null },
    { id: "ap3", kind: "addendum", entity: "addendum", entity_id: "z", details: { number: "AD-2026-002", title: "دهان سقف الملحق", total: 1400 }, created_at: "2026-11-22T13:00:00Z", link: null },
  ],
  teamCost: { monthly: 28500, allocated: 16200, toDate: 21900, unabsorbed: 5700 },
  canManage: true,
  canDecide: true,
  links: { contracts: true, projects: true, costs: true },
};
