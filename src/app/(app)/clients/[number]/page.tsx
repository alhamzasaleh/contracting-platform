import { getTranslations } from "next-intl/server";
import { ClientDetailView } from "@/components/clients/clients-view";
import { PageHeader } from "@/components/shell/app-shell";
import { can, requirePermission } from "@/lib/auth/session";
import { loadClientDetail } from "@/lib/data/clients";
import { createSurvey, deleteClient, deleteSurvey, readMapLink, readPlace, saveClient } from "../actions";

export default async function ClientPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const session = await requirePermission("clients.view");
  const t = await getTranslations("clients");
  const detail = await loadClientDetail(session, decodeURIComponent(number));
  return (
    <div>
      <PageHeader title={t("clientTitle")} />
      <ClientDetailView
        detail={detail}
        canManage={can(session, "clients.manage")}
        canQuote={can(session, "quotes.manage")}
        onSave={saveClient}
        onReadLink={readMapLink}
        onReadPlace={readPlace}
        onNewSurvey={createSurvey}
        onDelete={detail.canDelete ? deleteClient : undefined}
        onDeleteSurvey={detail.canDelete ? deleteSurvey : undefined}
      />
    </div>
  );
}
