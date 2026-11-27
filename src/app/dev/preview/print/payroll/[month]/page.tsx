import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { Payslips } from "@/components/team/payslips";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../sample";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_PAYROLL } from "../../../sample-payroll";

/** Payslips with sample data (same page as /print/payroll/<YYYY-MM>). */
export default async function PreviewPayslips({ params }: { params: Promise<{ month: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  const { month } = await params;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[720px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <Payslips org={{ name: "مؤسسة ملمس", legal_name: null, logoUrl: SAMPLE_LOGO }} month={/^\d{4}-\d{2}$/.test(month) ? month : SAMPLE_PAYROLL.month} lines={SAMPLE_PAYROLL.lines} />
    </main>
  );
}
