import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { isDesignPreviewEnabled } from "@/env";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_QUOTE_STAGE_ACCEPTED } from "../../sample-contracts";

/** The client page on the quote — accepted, waiting for the contract. */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_QUOTE_STAGE_ACCEPTED.org.brand.primary} accent={SAMPLE_QUOTE_STAGE_ACCEPTED.org.brand.accent} />
      <QuoteStageView data={SAMPLE_QUOTE_STAGE_ACCEPTED} logoUrl={SAMPLE_LOGO} number="Q-2026-007" token="preview" onAccept={previewNoop} onRequestChanges={previewNoop} onReject={previewNoop} />
    </>
  );
}
