import { PreferencesForm } from "@/components/settings/preferences-form";
import { getLocaleSettings } from "@/i18n/server";
import { SAMPLE_SHELL } from "../../../sample";

export default async function PreviewPreferences() {
  const { locale, numerals } = await getLocaleSettings();
  return <PreferencesForm preview initial={{ full_name: SAMPLE_SHELL.user.name, locale, numerals, theme: "system" }} />;
}
