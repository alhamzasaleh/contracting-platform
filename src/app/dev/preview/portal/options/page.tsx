import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PortalView } from "@/components/portal/portal-view";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_PORTAL_OPTIONS } from "../../sample-contracts";

export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_PORTAL_OPTIONS.org.brand.primary} accent={SAMPLE_PORTAL_OPTIONS.org.brand.accent} />
      <PortalView data={SAMPLE_PORTAL_OPTIONS} logoUrl={SAMPLE_LOGO} number="C-2026-004" token="preview" />
    </>
  );
}
