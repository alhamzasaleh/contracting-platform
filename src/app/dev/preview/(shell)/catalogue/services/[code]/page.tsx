import { ServiceDetailView } from "@/components/catalogue/service-detail-view";
import { SAMPLE_MATERIALS, SAMPLE_RECIPE, SAMPLE_SERVICES, SAMPLE_SPECS, SAMPLE_STAGES } from "../../../../sample-catalogue";

export default function P() {
  return (
    <ServiceDetailView
      service={SAMPLE_SERVICES[0]}
      stages={SAMPLE_STAGES}
      specs={SAMPLE_SPECS}
      recipe={SAMPLE_RECIPE}
      materials={SAMPLE_MATERIALS.map((m) => ({ id: m.id, name_ar: m.name_ar, unit: m.unit, brand: m.brand, coverage_per_unit: m.coverage_per_unit }))}
      defaultWastePercent={5}
      canManage
      canSeeCosts
      basePath="/dev/preview"
    />
  );
}
