import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PrintButton } from "@/components/quotes/print-button";
import { SubVoucherDocument } from "@/components/subcontractors/documents";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../sample";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_SUB_VOUCHER } from "../../../sample-subs";

/** A subcontractor payment voucher with sample data (same page as /print/sub-payments/<SP>). */
export default async function PreviewSubVoucher({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  await params;
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <SubVoucherDocument org={{ name: "مؤسسة ملمس", legal_name: null, cr_number: "1010123456", city: "الرياض", signatory_name: "صالح", signatory_title: "المدير", logoUrl: SAMPLE_LOGO }} data={SAMPLE_SUB_VOUCHER} />
    </main>
  );
}
