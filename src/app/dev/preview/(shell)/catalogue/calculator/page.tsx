import { PricingView } from "@/components/pricing/pricing-view";
import { linesToCatalogue } from "@/lib/catalogue/product-lines";
import { SAMPLE_ENGINE_DATA, SAMPLE_LINES } from "../../../sample-engine";

const SAMPLE_CTX = {
  catalogue: { ...SAMPLE_ENGINE_DATA, products: linesToCatalogue(SAMPLE_LINES) },
  external: [
    { id: "00000000-0000-4000-8000-000000000001", name: "مقاول أبو فهد", service: "exterior" as const, basis: "external_per_unit" as const, rate: 5 },
    { id: "00000000-0000-4000-8000-000000000002", name: "مؤسسة الإتقان", service: "gypsum" as const, basis: "external_per_unit" as const, rate: 11 },
  ],
  crew: [
    { id: "00000000-0000-4000-8000-000000000011", name: "محمد رفيق", job: "دهّان", perDay: 162 },
    { id: "00000000-0000-4000-8000-000000000012", name: "أنور حسين", job: "دهّان", perDay: 148 },
    { id: "00000000-0000-4000-8000-000000000013", name: "سالم عبدالله", job: "فني جبس", perDay: 175 },
  ],
  vatPercent: 0,
};

export default function P() {
  return <PricingView ctx={SAMPLE_CTX} templates={{}} canManage canSeeCrewCost />;
}
