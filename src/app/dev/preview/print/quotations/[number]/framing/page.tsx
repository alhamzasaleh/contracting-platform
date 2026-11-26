import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { FramingScreen } from "@/components/quotes/framing-document";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../../sample";
import { sampleQuoteFraming } from "../../../../sample-materials";
import { SAMPLE_ORG } from "../../../../sample-quotes";

/** Metal framing plan with sample data (same page as /print/quotations/<number>/framing). */
export default async function PreviewFraming({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  const { number } = await params;
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <FramingScreen org={SAMPLE_ORG} doc={sampleQuoteFraming()} path={`/print/quotations/${encodeURIComponent(number)}/framing`} base="/dev/preview" />
    </main>
  );
}
