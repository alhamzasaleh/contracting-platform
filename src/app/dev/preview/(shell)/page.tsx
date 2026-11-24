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
