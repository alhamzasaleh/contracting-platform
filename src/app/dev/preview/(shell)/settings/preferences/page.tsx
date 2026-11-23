import { PasskeysCard } from "@/components/settings/passkeys-card";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { getLocaleSettings } from "@/i18n/server";
import { SAMPLE_SHELL } from "../../../sample";

export default async function PreviewPreferences() {
  const { locale, numerals } = await getLocaleSettings();
  return (
    <div className="grid gap-6">
      <PreferencesForm preview initial={{ full_name: SAMPLE_SHELL.user.name, locale, numerals, theme: "system" }} />
      <PasskeysCard
        preview
        sample={[
          { id: "p1", friendly_name: "iPad Safari", created_at: "2026-11-20T09:00:00Z", last_used_at: "2026-11-23T07:30:00Z" },
          { id: "p2", friendly_name: "iPhone Safari", created_at: "2026-11-21T18:00:00Z" },
        ]}
      />
    </div>
  );
}
