import { DashboardView } from "@/components/dashboard/dashboard-view";
import { previewNoop } from "../../../preview-actions";
import { SAMPLE_SHELL } from "../../../sample";
import { SAMPLE_FINANCE } from "../../../sample-finance";

/** Home of a member who decides approvals but can't see finance (approvals.decide without finance.view). */
export default function PreviewHomeApprovals() {
  return (
    <DashboardView
      data={{
        userName: SAMPLE_SHELL.user.name,
        basePath: "/dev/preview",
        finance: null,
        approvals: SAMPLE_FINANCE.approvals,
        financeActions: { decide: previewNoop, saveCash: previewNoop },
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
