import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { InvoiceDocument } from "@/components/finance/invoice-document";
import { PrintButton } from "@/components/quotes/print-button";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../sample";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_CREDIT_NOTE } from "../../../sample-projects";

/** A credit note with sample data (same page as /print/credit-notes/<number>). */
export default async function PreviewCreditNote({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  await params;
  const c = SAMPLE_CREDIT_NOTE;
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <InvoiceDocument data={{ ...c, due_date: c.issue_date, paid: 0 }} logoUrl={SAMPLE_LOGO} credit={{ invoice: c.invoice }} />
    </main>
  );
}
