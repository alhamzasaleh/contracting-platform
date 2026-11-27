import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { QuoteStageView } from "@/components/portal/quote-stage";
import { isDesignPreviewEnabled } from "@/env";
import { previewNoop } from "../../preview-actions";
import { SAMPLE_QUOTE_STAGE } from "../../sample-contracts";

/** The client page on the quote when the client's record has no ID number: accepting asks for it. */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  const data = { ...SAMPLE_QUOTE_STAGE, client: { ...SAMPLE_QUOTE_STAGE.client, id_number: null } };
  return (
    <>
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <QuoteStageView data={data} logoUrl={SAMPLE_LOGO} number="Q-2026-007" token="preview" onAccept={previewNoop} onRequestChanges={previewNoop} onReject={previewNoop} />
    </>
  );
}
