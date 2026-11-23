import { getTranslations } from "next-intl/server";
import { ProjectsList } from "@/components/projects/project-views";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadProjects } from "@/lib/data/projects";

export default async function ProjectsPage() {
  const session = await requirePermission("projects.view");
  const t = await getTranslations("projects");
  return (
    <div className="min-w-0">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ProjectsList projects={await loadProjects(session)} />
    </div>
  );
}
