import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { SubPortalView } from "@/components/subcontractors/sub-portal";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_LOGO } from "../sample-logo";
import { SAMPLE_SUB_PAGE } from "../sample-subs";

/** The subcontractor's own page with sample data (same view as /s/<SC>/<token>). */
export default function PreviewSubPage() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_SUB_PAGE.org.brand.primary} accent={SAMPLE_SUB_PAGE.org.brand.accent} />
      <SubPortalView data={SAMPLE_SUB_PAGE} logoUrl={SAMPLE_LOGO} token="previewtoken0001" />
    </>
  );
}
