import { getTranslations } from "next-intl/server";
import { ProjectView } from "@/components/projects/project-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadProject } from "@/lib/data/projects";
import { checkIn, deleteMeasurement, draftReport, readSiteLink, recordMeasurementRefund, saveMeasurement, saveProgress, saveProjectSite, sendMeasurement, sendStage, updateNote, uploadPhoto } from "../actions";

export default async function ProjectPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ m?: string }> }) {
  const session = await requirePermission("projects.view");
  const t = await getTranslations("projects");
  const { number } = await params;
  const { m } = await searchParams;
  const data = await loadProject(session, decodeURIComponent(number));
  return (
    <div className="min-w-0">
      <PageHeader title={t("projectTitle")} />
      <ProjectView data={data} actions={{
          checkIn, uploadPhoto, saveProgress, draftReport, sendStage, updateNote, saveSite: saveProjectSite, readSiteLink,
          measure: { save: saveMeasurement, send: sendMeasurement, remove: deleteMeasurement, refund: recordMeasurementRefund },
        }}
        focusMeasure={typeof m === "string" ? m : null}
      />
    </div>
  );
}
