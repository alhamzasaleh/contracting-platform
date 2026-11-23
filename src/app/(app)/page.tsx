import { DashboardView } from "@/components/dashboard/dashboard-view";
import { can, getSession } from "@/lib/auth/session";
import { loadOwnerFinance, loadPendingApprovals } from "@/lib/data/finance";
import { expiringDocuments } from "@/lib/hr";
import { decideFromDashboard, saveCashSettings } from "./reports/actions";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const session = await getSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.organization.id);

  const org = session.organization;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const finance = can(session, "finance.view") ? await loadOwnerFinance(session, today) : null;
  // an approver without finance.view still gets the approvals card (approve in one tap)
  const approvals = !finance && can(session, "approvals.decide") ? await loadPendingApprovals(session) : null;
  let expiring: { total: number; expired: number } | null = null;
  if (can(session, "hr.view")) {
    const { data: emps } = await supabase.from("employees").select("id, full_name, status, id_expiry, passport_expiry, insurance_expiry").eq("organization_id", org.id);
    const docs = expiringDocuments(emps ?? [], today);
    expiring = { total: docs.length, expired: docs.filter((d) => d.level === "expired").length };
  }
  return (
    <DashboardView
      data={{
        userName: session.profile.full_name,
        finance,
        approvals,
        expiring,
        financeActions: { decide: decideFromDashboard, saveCash: saveCashSettings },
        setup: [
          { key: "setupCompany", done: Boolean(org.cr_number && org.vat_number), href: "/settings" },
          { key: "setupLogo", done: Boolean(org.logo_path), href: "/settings/branding" },
          { key: "setupTeam", done: (count ?? 1) > 1, href: "/settings/members" },
          { key: "setupCatalogue", done: finance ? finance.profits.length > 0 : false, href: "/catalogue" },
        ],
      }}
    />
  );
}
