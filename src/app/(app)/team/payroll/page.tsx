import { PayrollView } from "@/components/team/payroll-view";
import { requirePermission } from "@/lib/auth/session";
import { loadPayroll } from "@/lib/data/payroll";
import { addAdvance, approvePayroll, createPayrollRun, deleteAdvance, markPayrollPaid, updatePayrollLine } from "../payroll-actions";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const session = await requirePermission("hr.view");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const { month } = await searchParams;
  const m = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  return (
    <PayrollView
      data={await loadPayroll(session, m, today)}
      today={today}
      actions={{ create: createPayrollRun, update: updatePayrollLine, approve: approvePayroll, paid: markPayrollPaid, addAdvance, deleteAdvance }}
    />
  );
}
