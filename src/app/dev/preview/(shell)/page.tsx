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
