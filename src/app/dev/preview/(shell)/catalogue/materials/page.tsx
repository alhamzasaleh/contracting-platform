import { MaterialsView } from "@/components/catalogue/materials-view";
import { SAMPLE_MATERIALS } from "../../../sample-catalogue";

export default function P() {
  return <MaterialsView materials={SAMPLE_MATERIALS} canManage canSeeCosts />;
}
