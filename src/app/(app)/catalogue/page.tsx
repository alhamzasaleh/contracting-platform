import { ServicesView } from "@/components/catalogue/services-view";
import { can, getSession } from "@/lib/auth/session";
import { loadServices } from "@/lib/data/catalogue";
import { saveService, seedCatalogue } from "./actions";

export default async function CataloguePage() {
  const session = await getSession();
  const services = await loadServices(session);
  return <ServicesView services={services} canManage={can(session, "catalogue.manage")} actions={{ seed: seedCatalogue, save: saveService }} />;
}
