import { ProductsView } from "@/components/catalogue/products-view";
import { SAMPLE_SUPPLIERS } from "../../../sample-catalogue";
import { SAMPLE_BRANDS, SAMPLE_GROUPS, SAMPLE_PRODUCTS } from "../../../sample-engine";

export default function P() {
  return <ProductsView products={SAMPLE_PRODUCTS} brands={SAMPLE_BRANDS} groups={SAMPLE_GROUPS} suppliers={SAMPLE_SUPPLIERS} canManage canSeeCosts />;
}
