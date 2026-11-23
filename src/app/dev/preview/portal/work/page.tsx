import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PortalView } from "@/components/portal/portal-view";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_PORTAL_WORK } from "../../sample-projects";

export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  return (
    <>
      <BrandStyle primary={SAMPLE_PORTAL_WORK.org.brand.primary} accent={SAMPLE_PORTAL_WORK.org.brand.accent} />
      <PortalView data={SAMPLE_PORTAL_WORK} logoUrl={null} number="C-2026-004" token="preview" />
    </>
  );
}
