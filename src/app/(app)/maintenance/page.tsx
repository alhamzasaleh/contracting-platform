import { getTranslations } from "next-intl/server";
import { MaintenanceView } from "@/components/projects/maintenance-view";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadMaintenance } from "@/lib/data/maintenance";
import { createMaintenance, updateMaintenance } from "./actions";

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<{ r?: string; contract?: string }> }) {
  const session = await requirePermission("projects.view");
  const t = await getTranslations("maintenance");
  const { r, contract } = await searchParams;
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MaintenanceView data={await loadMaintenance(session)} focus={r ?? null} contract={typeof contract === "string" && /^C-\d{4}-\d{3,6}$/.test(contract) ? contract : null} actions={{ update: updateMaintenance, create: createMaintenance }} />
    </div>
  );
}
