import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { isDesignPreviewEnabled } from "@/env";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_QUOTE_STAGE_REJECTED } from "../../sample-contracts";

/** The client page on the quote — declined (final, with the reason). */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_QUOTE_STAGE_REJECTED.org.brand.primary} accent={SAMPLE_QUOTE_STAGE_REJECTED.org.brand.accent} />
      <QuoteStageView data={SAMPLE_QUOTE_STAGE_REJECTED} logoUrl={SAMPLE_LOGO} number="Q-2026-007" token="preview" onAccept={previewNoop} onRequestChanges={previewNoop} onReject={previewNoop} />
    </>
  );
}
