import { ServiceDetailView } from "@/components/catalogue/service-detail-view";
import { can, getSession } from "@/lib/auth/session";
import { loadServiceDetail } from "@/lib/data/catalogue";
import {
  deleteRecipeLine,
  deleteSpec,
  deleteStage,
  moveStage,
  saveRecipeLine,
  saveService,
  saveSpec,
  saveStage,
} from "../../actions";

export default async function ServicePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession();
  const d = await loadServiceDetail(session, decodeURIComponent(code));
  return (
    <ServiceDetailView
      {...d}
      canManage={can(session, "catalogue.manage")}
      canSeeCosts={can(session, "costs.view")}
      actions={{ saveService, saveStage, moveStage, deleteStage, saveSpec, deleteSpec, saveRecipeLine, deleteRecipeLine }}
    />
  );
}
