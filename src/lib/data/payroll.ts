import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import { expiringDocuments, type ExpiringDoc } from "@/lib/hr";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

export type PayrollLineView = {
  id: string; employee_id: string; full_name: string; iban: string | null; basic: number; housing: number; transport: number; other: number;
  overtime: number; deductions: number; advances: number; net: number; note: string | null;
};
export type PayrollData = {
  month: string; // YYYY-MM
  run: { id: string; status: "draft" | "approved" | "paid"; approved_at: string | null; paid_on: string | null } | null;
  lines: PayrollLineView[];
  runs: { month: string; status: string; total: number }[];
  employees: { id: string; full_name: string }[];
  advances: { id: string; employee_id: string; name: string; given_on: string; amount: number; note: string | null; deducted: boolean; /** deducted by approved runs so far (partial deductions carry over) */ deductedAmount?: number }[];
  expiring: ExpiringDoc[];
  canManage: boolean;
  canApprove: boolean;
  canPay: boolean;
};

export async function loadPayroll(session: SessionContext, month: string, today: string): Promise<PayrollData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: runs }, { data: employees }, { data: advances }] = await Promise.all([
    supabase.from("payroll_runs").select("id, month, status, approved_at, paid_on").eq("organization_id", orgId).order("month", { ascending: false }).limit(24),
    supabase.from("employees").select("id, full_name, status, id_expiry, passport_expiry, insurance_expiry").eq("organization_id", orgId).order("full_name"),
    supabase.from("employee_advances").select("id, employee_id, given_on, amount, note, deducted_in_run, deducted_amount").eq("organization_id", orgId).order("given_on", { ascending: false }).limit(200),
  ]);
  const run = (runs ?? []).find((r) => r.month.slice(0, 7) === month) ?? null;
  const ids = (runs ?? []).map((r) => r.id);
  const { data: allLines } = ids.length ? await supabase.from("payroll_lines").select("*").in("run_id", ids) : { data: [] };
  const names = new Map((employees ?? []).map((e) => [e.id, e.full_name]));
  return {
    month,
    run: run ? { id: run.id, status: run.status, approved_at: run.approved_at, paid_on: run.paid_on } : null,
    lines: (allLines ?? [])
      .filter((l) => l.run_id === run?.id)
      .map((l) => ({ id: l.id, employee_id: l.employee_id, full_name: l.full_name, iban: l.iban, basic: n(l.basic), housing: n(l.housing), transport: n(l.transport), other: n(l.other), overtime: n(l.overtime), deductions: n(l.deductions), advances: n(l.advances), net: n(l.net), note: l.note }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")),
    runs: (runs ?? []).map((r) => ({ month: r.month.slice(0, 7), status: r.status, total: (allLines ?? []).filter((l) => l.run_id === r.id).reduce((s, l) => s + n(l.net), 0) })),
    employees: (employees ?? []).filter((e) => e.status !== "final_exit").map((e) => ({ id: e.id, full_name: e.full_name })),
    advances: (advances ?? []).map((a) => ({ id: a.id, employee_id: a.employee_id, name: names.get(a.employee_id) ?? "—", given_on: a.given_on, amount: n(a.amount), note: a.note, deducted: !!a.deducted_in_run, deductedAmount: n(a.deducted_amount) })),
    expiring: expiringDocuments(employees ?? [], today),
    canManage: can(session, "hr.manage"),
    canApprove: can(session, "hr.manage") && can(session, "approvals.decide"),
    canPay: can(session, "hr.manage") || can(session, "finance.manage"),
  };
}
