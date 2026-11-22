import { ProductsView } from "@/components/catalogue/products-view";
import { can, getSession } from "@/lib/auth/session";
import { loadProducts } from "@/lib/data/engine";
import { addProductPack, addProductPrice, deleteProductPack, saveProduct, seedPricingEngine } from "../engine-actions";

export default async function ProductsPage() {
  const session = await getSession();
  const data = await loadProducts(session);
  return (
    <ProductsView
      {...data}
      canManage={can(session, "catalogue.manage")}
      canSeeCosts={can(session, "costs.view")}
      actions={{ seed: seedPricingEngine, saveProduct, addPack: addProductPack, deletePack: deleteProductPack, addPrice: addProductPrice }}
    />
  );
}
