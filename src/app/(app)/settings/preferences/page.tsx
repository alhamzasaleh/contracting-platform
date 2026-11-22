import { PreferencesForm } from "@/components/settings/preferences-form";
import { getSession } from "@/lib/auth/session";

export default async function PreferencesPage() {
  const { profile } = await getSession();
  return (
    <PreferencesForm
      initial={{ full_name: profile.full_name, locale: profile.locale, numerals: profile.numerals, theme: profile.theme }}
    />
  );
}
