import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { isDesignPreviewEnabled } from "@/env";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_QUOTE_STAGE_REVISING } from "../../sample-contracts";

/** The client page on the quote — a new version is being prepared. */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_QUOTE_STAGE_REVISING.org.brand.primary} accent={SAMPLE_QUOTE_STAGE_REVISING.org.brand.accent} />
      <QuoteStageView data={SAMPLE_QUOTE_STAGE_REVISING} logoUrl={SAMPLE_LOGO} number="Q-2026-007" token="preview" onAccept={previewNoop} onRequestChanges={previewNoop} onReject={previewNoop} />
    </>
  );
}
