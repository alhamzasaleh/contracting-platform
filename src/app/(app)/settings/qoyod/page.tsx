import { notFound } from "next/navigation";
import { QoyodSettingsView } from "@/components/settings/qoyod-view";
import { can, getSession } from "@/lib/auth/session";
import { loadQoyod } from "@/lib/data/qoyod";

export default async function QoyodPage() {
  const session = await getSession();
  if (!can(session, "settings.manage") && !can(session, "finance.view")) notFound();
  return <QoyodSettingsView data={await loadQoyod(session)} />;
}
