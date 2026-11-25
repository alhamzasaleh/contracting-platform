import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { MarketerPortalView } from "@/components/marketers/marketer-portal";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_LOGO } from "../sample-logo";
import { SAMPLE_PARTNER_PAGE } from "../sample-marketers";

export default function PreviewPartnerPage() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_PARTNER_PAGE.org.brand.primary} accent={SAMPLE_PARTNER_PAGE.org.brand.accent} />
      <MarketerPortalView data={SAMPLE_PARTNER_PAGE} logoUrl={SAMPLE_LOGO} token="previewtoken0001" />
    </>
  );
}
