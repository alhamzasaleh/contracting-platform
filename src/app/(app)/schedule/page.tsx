import { getTranslations } from "next-intl/server";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { PageHeader } from "@/components/shell/app-shell";
import { requirePermission } from "@/lib/auth/session";
import { loadSchedule } from "@/lib/data/schedule";
import { deleteEntry, saveEntry, saveTeam } from "./actions";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ contract?: string }> }) {
  const session = await requirePermission("schedule.view");
  const t = await getTranslations("schedule");
  const { contract } = await searchParams;
  const data = await loadSchedule(session);
  // today in Riyadh, decided on the server so the page renders the same everywhere
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return (
    <div className="min-w-0">
      <PageHeader title={t("pageTitle")} description={t("pageSubtitle")} />
      <ScheduleView
        data={data}
        today={today}
        openContract={typeof contract === "string" && /^C-\d{4}-\d{3,6}$/.test(contract) ? contract : undefined}
        actions={{ saveTeam, saveEntry, deleteEntry }}
      />
    </div>
  );
}
