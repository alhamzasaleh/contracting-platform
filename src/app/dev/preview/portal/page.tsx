import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PortalView } from "@/components/portal/portal-view";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_PORTAL } from "../sample-contracts";

export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_PORTAL.org.brand.primary} accent={SAMPLE_PORTAL.org.brand.accent} />
      <PortalView data={SAMPLE_PORTAL} logoUrl={null} number="C-2026-004" token="preview" />
    </>
  );
}
