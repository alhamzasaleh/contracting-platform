import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { MarketerPortalView } from "@/components/marketers/marketer-portal";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_LOGO } from "../../sample-logo";
import { SAMPLE_PARTNER_PAGE_EMPTY } from "../../sample-marketers";

export default function PreviewPartnerPageEmpty() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_PARTNER_PAGE_EMPTY.org.brand.primary} accent={SAMPLE_PARTNER_PAGE_EMPTY.org.brand.accent} />
      <MarketerPortalView data={SAMPLE_PARTNER_PAGE_EMPTY} logoUrl={SAMPLE_LOGO} token="previewtoken0001" />
    </>
  );
}
