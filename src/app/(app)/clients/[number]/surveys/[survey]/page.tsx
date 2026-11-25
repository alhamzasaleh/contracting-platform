import { getTranslations } from "next-intl/server";
import { SurveyView } from "@/components/clients/survey-view";
import { PageHeader } from "@/components/shell/app-shell";
import { can, requirePermission } from "@/lib/auth/session";
import { loadSurvey } from "@/lib/data/clients";
import { deleteRoom, deleteSurvey, draftSurveyAi, readPlanAi, saveRoom, saveSurvey } from "../../../actions";

/** reading a floor plan sheet with the AI can take a couple of minutes */
export const maxDuration = 300;

export default async function SurveyPage({ params }: { params: Promise<{ number: string; survey: string }> }) {
  const { number, survey } = await params;
  const session = await requirePermission("clients.view");
  const t = await getTranslations("survey");
  const detail = await loadSurvey(session, decodeURIComponent(number), decodeURIComponent(survey));
  return (
    <div>
      <PageHeader title={t("pageTitle")} description={t("pageSubtitle")} />
      <SurveyView
        detail={detail}
        canManage={can(session, "clients.manage")}
        canQuote={can(session, "quotes.manage") && can(session, "costs.view")}
        actions={{ saveSurvey, saveRoom, deleteRoom, draftAi: draftSurveyAi, readPlan: readPlanAi, ...(detail.canDelete ? { deleteSurvey } : {}) }}
      />
    </div>
  );
}
