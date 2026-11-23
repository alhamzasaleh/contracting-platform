import type { PayrollData } from "@/lib/data/payroll";

export const SAMPLE_PAYROLL: PayrollData = {
  month: "2026-11",
  run: { id: "r1", status: "draft", approved_at: null, paid_on: null },
  lines: [
    { id: "l1", employee_id: "e1", full_name: "أحمد محمود", iban: "SA0380000000608010167519", basic: 3000, housing: 750, transport: 300, other: 0, overtime: 200, deductions: 0, advances: 500, net: 3750, note: null },
    { id: "l2", employee_id: "e3", full_name: "محمد إقبال", iban: null, basic: 2200, housing: 550, transport: 250, other: 0, overtime: 0, deductions: 100, advances: 0, net: 2900, note: null },
  ],
  runs: [
    { month: "2026-11", status: "draft", total: 6650 },
    { month: "2026-10", status: "paid", total: 6400 },
  ],
  employees: [{ id: "e1", full_name: "أحمد محمود" }, { id: "e3", full_name: "محمد إقبال" }],
  advances: [
    { id: "a1", employee_id: "e1", name: "أحمد محمود", given_on: "2026-11-10", amount: 500, note: "سلفة طارئة", deducted: false, deductedAmount: 200 },
    { id: "a0", employee_id: "e3", name: "محمد إقبال", given_on: "2026-10-05", amount: 300, note: null, deducted: true },
  ],
  expiring: [
    { employee_id: "e3", name: "محمد إقبال", kind: "insurance", date: "2026-11-15", days: -8, level: "expired" },
    { employee_id: "e1", name: "أحمد محمود", kind: "id", date: "2026-12-10", days: 17, level: "30" },
  ],
  canManage: true,
  canApprove: true,
  canPay: true,
};
