import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";
import { requirePermission } from "@/lib/auth/session";

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  await requirePermission("hr.view");
  const t = await getTranslations("hr");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs
        tabs={[
          { href: "/team", label: t("tabEmployees"), exact: true },
          { href: "/team/costs", label: t("tabCosts") },
          { href: "/team/payroll", label: t("tabPayroll") },
        ]}
      />
      {children}
    </div>
  );
}
