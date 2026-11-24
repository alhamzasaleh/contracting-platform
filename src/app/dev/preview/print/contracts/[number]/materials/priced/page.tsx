import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { MaterialsScreen } from "@/components/quotes/materials-document";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../../../sample";
import { sampleProjectMaterials } from "../../../../../sample-materials";
import { SAMPLE_ORG } from "../../../../../sample-quotes";

/** Bill of quantities with sample data (same page as /print/contracts/<number>/materials/priced). */
export default async function PreviewMaterials({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  const { number } = await params;
  const doc = sampleProjectMaterials(true, decodeURIComponent(number));
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <MaterialsScreen org={SAMPLE_ORG} doc={doc} path={`/print/contracts/${encodeURIComponent(number)}/materials`} base="/dev/preview" />
    </main>
  );
}
