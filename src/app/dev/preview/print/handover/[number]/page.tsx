import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { HandoverCertificate } from "@/components/projects/handover-certificate";
import { PrintButton } from "@/components/quotes/print-button";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../sample";
import { SAMPLE_LOGO } from "../../../sample-logo";

/** Final handover certificate with sample data (same page as /print/handover/<number>). */
export default async function PreviewHandover({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  const { number } = await params;
  return (
    <main className="min-h-dvh bg-background py-6 print:bg-white print:py-0">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <HandoverCertificate
        data={{
          org: { name: "مؤسسة ملمس", legal_name: null, cr_number: "1010123456", logoUrl: SAMPLE_LOGO },
          client: { name: "أبو محمد العتيبي", id_number: "1000000008" },
          contract: { number: decodeURIComponent(number), service: "gypsum", warranty_months: 6 },
          final: { confirmed_at: "2026-11-20T10:30:00Z", confirmed_name: "أبو محمد العتيبي", signature: null },
        }}
      />
    </main>
  );
}
