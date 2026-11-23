import { getTranslations } from "next-intl/server";
import { ProjectView } from "@/components/projects/project-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadProject } from "@/lib/data/projects";
import { checkIn, draftReport, saveProgress, sendStage, updateNote, uploadPhoto } from "../actions";

export default async function ProjectPage({ params }: { params: Promise<{ number: string }> }) {
  const session = await requirePermission("projects.view");
  const t = await getTranslations("projects");
  const { number } = await params;
  const data = await loadProject(session, decodeURIComponent(number));
  return (
    <div className="min-w-0">
      <PageHeader title={t("projectTitle")} />
      <ProjectView data={data} actions={{ checkIn, uploadPhoto, saveProgress, draftReport, sendStage, updateNote }} />
    </div>
  );
}
