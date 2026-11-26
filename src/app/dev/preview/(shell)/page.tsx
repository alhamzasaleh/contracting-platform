import { DashboardView } from "@/components/dashboard/dashboard-view";
import { SAMPLE_SHELL } from "../sample";
import { SAMPLE_FINANCE } from "../sample-finance";

export default function PreviewDashboard() {
  return (
    <DashboardView
      data={{
        userName: SAMPLE_SHELL.user.name,
        basePath: "/dev/preview",
        finance: SAMPLE_FINANCE,
        upcomingSurveys: [
          { number: "SV-2026-011", date: "2026-11-27", time: "09:30", client: { number: "CL-2026-002", name: "عبدالله الشهري" }, site: { lat: 24.8031, lng: 46.6105 } },
          { number: "SV-2026-012", date: "2026-11-29", time: null, client: { number: "CL-2026-005", name: "أبو فهد القحطاني" }, site: null },
        ],
        quotesWaiting: [
          { number: "Q-2026-007", client: "أبو محمد العتيبي", kind: "contract", since: "2026-11-23T18:40:00Z", href: "/contracts/new?quote=Q-2026-007" },
          { number: "Q-2026-009", client: "شركة البناء المتقن", kind: "changes", since: "2026-11-24T09:10:00Z", href: "/quotations/Q-2026-009" },
        ],
        setup: [
          { key: "setupCompany", done: true, href: "/settings" },
          { key: "setupLogo", done: false, href: "/settings/branding" },
          { key: "setupTeam", done: true, href: "/settings/members" },
          { key: "setupCatalogue", done: false },
        ],
      }}
    />
  );
}
