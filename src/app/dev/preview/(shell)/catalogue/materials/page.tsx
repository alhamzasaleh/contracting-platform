import { MaterialsView } from "@/components/catalogue/materials-view";
import { SAMPLE_MATERIALS, SAMPLE_SUPPLIERS } from "../../../sample-catalogue";

export default function P() {
  return <MaterialsView materials={SAMPLE_MATERIALS} suppliers={SAMPLE_SUPPLIERS} canManage canSeeCosts />;
}
