import { SAMPLE_LOGO } from "../../sample-logo";
import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { PortalView } from "@/components/portal/portal-view";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_PORTAL } from "../../sample-contracts";

/** The contract awaiting the client's signature when his record still has no ID number. */
export default function P() {
  if (!isDesignPreviewEnabled()) notFound();
  const data = { ...SAMPLE_PORTAL, client: { ...SAMPLE_PORTAL.client, id_number: null } };
  return (
    <>
      <BrandStyle primary={data.org.brand.primary} accent={data.org.brand.accent} />
      <PortalView data={data} logoUrl={SAMPLE_LOGO} number="C-2026-004" token="preview" />
    </>
  );
}
