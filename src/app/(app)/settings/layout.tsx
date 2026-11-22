import { getTranslations } from "next-intl/server";
import { SettingsFrame } from "@/components/settings/settings-nav";
import { getSession } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [session, t] = await Promise.all([getSession(), getTranslations("settings")]);
  return (
    <SettingsFrame permissions={session.permissions} title={t("title")} description={t("subtitle")}>
      {children}
    </SettingsFrame>
  );
}
