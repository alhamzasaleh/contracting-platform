import { ProductLinesView } from "@/components/catalogue/product-lines-view";
import { can, getSession } from "@/lib/auth/session";
import { loadProductLines } from "@/lib/data/engine";
import { addBrandToLine, addProductPack, addProductPrice, deleteProductPack, saveLine, seedPricingEngine, updateBrandRow } from "../engine-actions";

export default async function ProductsPage() {
  const session = await getSession();
  const { lines, unlinked, brands, suppliers } = await loadProductLines(session);
  return (
    <ProductLinesView
      lines={lines}
      unlinked={unlinked}
      brands={brands}
      suppliers={suppliers}
      canManage={can(session, "catalogue.manage")}
      canSeeCosts={can(session, "costs.view")}
      actions={{
        seed: seedPricingEngine,
        saveLine,
        addBrand: addBrandToLine,
        updateBrand: updateBrandRow,
        addPack: addProductPack,
        deletePack: deleteProductPack,
        addPrice: addProductPrice,
      }}
    />
  );
}
