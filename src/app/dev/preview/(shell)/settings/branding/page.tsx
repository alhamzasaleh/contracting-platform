import { BrandingEditor } from "@/components/settings/branding-editor";
import { SAMPLE_ORG } from "../../../sample";

export default function PreviewBranding() {
  return <BrandingEditor orgName={SAMPLE_ORG.name} initialBrand={SAMPLE_ORG.brand} initialLogoUrl={null} canEdit />;
}
