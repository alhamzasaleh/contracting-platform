import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { isDesignPreviewEnabled } from "@/env";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_QUOTE_STAGE_CHANGES } from "../../sample-contracts";

/** The client page on the quote — after a change request (the client can still accept or decline). */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_QUOTE_STAGE_CHANGES.org.brand.primary} accent={SAMPLE_QUOTE_STAGE_CHANGES.org.brand.accent} />
      <QuoteStageView data={SAMPLE_QUOTE_STAGE_CHANGES} logoUrl={SAMPLE_LOGO} number="Q-2026-007" token="preview" onAccept={previewNoop} onRequestChanges={previewNoop} onReject={previewNoop} />
    </>
  );
}
