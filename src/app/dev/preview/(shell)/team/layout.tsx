import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shell/app-shell";
import { SectionTabs } from "@/components/ui/section-tabs";

export default async function PreviewTeamLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("hr");
  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SectionTabs
        basePath="/dev/preview"
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
