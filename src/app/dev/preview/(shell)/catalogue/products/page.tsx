import { ProductLinesView } from "@/components/catalogue/product-lines-view";
import { SAMPLE_SUPPLIERS } from "../../../sample-catalogue";
import { SAMPLE_BRANDS, SAMPLE_LINES } from "../../../sample-engine";

export default function P() {
  return <ProductLinesView lines={SAMPLE_LINES} brands={SAMPLE_BRANDS} suppliers={SAMPLE_SUPPLIERS} canManage canSeeCosts />;
}
