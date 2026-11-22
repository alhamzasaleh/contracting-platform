import { SuppliersView } from "@/components/catalogue/suppliers-view";
import { SAMPLE_SUPPLIERS } from "../../../sample-catalogue";

export default function P() {
  return <SuppliersView suppliers={SAMPLE_SUPPLIERS} canManage />;
}
