import { getTranslations } from "next-intl/server";
import { SettingsFrame } from "@/components/settings/settings-nav";
import { SAMPLE_SHELL } from "../../sample";

export default async function PreviewSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("settings");
  return (
    <SettingsFrame permissions={SAMPLE_SHELL.permissions} basePath="/dev/preview" title={t("title")} description={t("subtitle")}>
      {children}
    </SettingsFrame>
  );
}
