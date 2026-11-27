import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubStatementDocument } from "@/components/subcontractors/documents";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../../sample";
import { SAMPLE_LOGO } from "../../../../sample-logo";
import { SAMPLE_SUB_STATEMENT } from "../../../../sample-subs";

/** A subcontractor statement with sample data (same page as /print/subcontractors/<SC>/statement). */
export default async function PreviewSubStatement({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  await params;
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <SubStatementDocument org={{ name: "مؤسسة ملمس", legal_name: null, cr_number: "1010123456", city: "الرياض", logoUrl: SAMPLE_LOGO }} data={SAMPLE_SUB_STATEMENT} />
    </main>
  );
}
