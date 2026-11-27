import { notFound } from "next/navigation";
import { BrandStyle } from "@/components/brand-style";
import { MeasurementDocument } from "@/components/projects/measurement-document";
import { PrintButton } from "@/components/quotes/print-button";
import { isDesignPreviewEnabled } from "@/env";
import { SAMPLE_ORG as BRAND } from "../../../sample";
import { SAMPLE_LOGO } from "../../../sample-logo";
import { SAMPLE_MEASUREMENTS } from "../../../sample-projects";

/** Measurement sheet with sample data (same page as /print/measurements/<number>). */
export default async function PreviewMeasurement({ params }: { params: Promise<{ number: string }> }) {
  if (!isDesignPreviewEnabled()) notFound();
  const { number } = await params;
  const m = SAMPLE_MEASUREMENTS.find((x) => x.number === decodeURIComponent(number)) ?? SAMPLE_MEASUREMENTS[0];
  return (
    <main className="min-h-dvh bg-background py-6">
      <BrandStyle primary={BRAND.brand.primary} accent={BRAND.brand.accent} />
      <div className="mx-auto mb-4 flex max-w-[820px] justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      <MeasurementDocument
        data={{
          org: { name: "مؤسسة ملمس", legal_name: null, cr_number: "1010123456", logoUrl: SAMPLE_LOGO },
          client: { name: "شركة البناء المتقن" },
          contract: { number: "C-2026-003" },
          sheet: { ...m, photos: m.photos.map((p) => p.url!), signature: null },
        }}
      />
    </main>
  );
}
