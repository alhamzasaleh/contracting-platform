import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { Payslips } from "@/components/team/payslips";
import { requirePermission } from "@/lib/auth/session";
import { loadPayroll } from "@/lib/data/payroll";
import { logoDataUrl } from "@/lib/org";

/** Payslips for a month (Share → Print → PDF on the iPad). hr.view only. */
export default async function PrintPayrollPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();
  const session = await requirePermission("hr.view");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const [data, logoUrl] = await Promise.all([loadPayroll(session, month, today), logoDataUrl(session.organization.logo_path)]);
  if (!data.run) notFound();
  const o = session.organization;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={o.brand.primary} accent={o.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[720px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <Payslips org={{ name: o.name, legal_name: o.legal_name, logoUrl }} month={month} lines={data.lines} />
    </main>
  );
}
