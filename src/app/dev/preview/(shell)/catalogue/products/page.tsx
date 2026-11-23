import { ProductLinesView } from "@/components/catalogue/product-lines-view";
import { SAMPLE_SUPPLIERS } from "../../../sample-catalogue";
import { SAMPLE_BRANDS, SAMPLE_LINES } from "../../../sample-engine";

export default function P() {
  return <ProductLinesView
      lines={SAMPLE_LINES}
      brands={SAMPLE_BRANDS}
      suppliers={SAMPLE_SUPPLIERS}
      canManage
      canSeeCosts
      datasheetSample={{
        product_name: "Fenomastic My Home Smooth", brand: "Jotun", category: "finish_paint", unit: "L", coverage_m2_per_unit: 10,
        coverage_text: "10–12 م²/لتر للوجه", pack_sizes: [18, 3.6, 1], recommended_coats: 2, drying_time: "جاف باللمس ساعة، الوجه الثاني بعد ٤ ساعات",
        use: "interior", notes: ["يُخفّف بالماء ٥–١٠٪ للوجه الأول"], unclear: [], flags: [],
      }}
    />;
}
