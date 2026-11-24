import { DashboardView } from "@/components/dashboard/dashboard-view";
import { SAMPLE_SHELL } from "../../../sample";

/** Home without finance or approvals (a new member, or before any data): the getting-started view. */
export default function PreviewHomeNew() {
  return (
    <DashboardView
      data={{
        userName: SAMPLE_SHELL.user.name,
        basePath: "/dev/preview",
        finance: null,
        setup: [
          { key: "setupCompany", done: true, href: "/settings" },
          { key: "setupLogo", done: false, href: "/settings/branding" },
          { key: "setupTeam", done: false, href: "/settings/members" },
          { key: "setupCatalogue", done: false },
        ],
      }}
    />
  );
}
