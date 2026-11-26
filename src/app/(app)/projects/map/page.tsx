import { getTranslations } from "next-intl/server";
import { ProjectsMapView } from "@/components/projects/projects-map";
import { PageHeader } from "@/components/shell/app-shell";
import { can, requirePermission } from "@/lib/auth/session";
import { loadProjects } from "@/lib/data/projects";

/** «خريطة المشاريع»: every running project on one map (projects.view, like the list). */
export default async function ProjectsMapPage() {
  const session = await requirePermission("projects.view");
  const t = await getTranslations("maps");
  return (
    <div className="min-w-0">
      <PageHeader title={t("projectsMap")} description={t("projectsMapSub")} />
      <ProjectsMapView projects={await loadProjects(session)} canSetSite={can(session, "clients.manage")} />
    </div>
  );
}
