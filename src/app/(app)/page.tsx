import { DashboardView } from "@/components/dashboard/dashboard-view";
import { can, getSession } from "@/lib/auth/session";
import { loadOwnerFinance, loadPendingApprovals } from "@/lib/data/finance";
import { expiringDocuments } from "@/lib/hr";
import { loadQuotesWaiting } from "@/lib/data/quotes";
import { loadUpcomingSurveys } from "@/lib/data/clients";
import { teamSetupStep } from "@/lib/hr/access";
import { decideFromDashboard, saveCashSettings } from "./reports/actions";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const session = await getSession();
  const supabase = await createClient();
  const org = session.organization;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  // all independent: one parallel round
  const [{ count }, finance, approvals, expiring, { count: pendingInvites }, { count: withoutAccess }, quotesWaiting, upcoming] = await Promise.all([
    supabase.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", org.id),
    can(session, "finance.view") ? loadOwnerFinance(session, today) : Promise.resolve(null),
    // an approver without finance.view still gets the approvals card (approve in one tap)
    !can(session, "finance.view") && can(session, "approvals.decide") ? loadPendingApprovals(session) : Promise.resolve(null),
    can(session, "hr.view")
      ? supabase
          .from("employees").select("id, full_name, status, id_expiry, passport_expiry, insurance_expiry").eq("organization_id", org.id)
          .then(({ data: emps }) => {
            const docs = expiringDocuments(emps ?? [], today);
            return { total: docs.length, expired: docs.filter((d) => d.level === "expired").length };
          })
      : Promise.resolve(null),
    // «ادعُ فريقك»: pending invitations count as progress (members.manage reads them)
    can(session, "members.manage")
      ? supabase.from("member_invitations").select("id", { count: "exact", head: true }).eq("organization_id", org.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
      : Promise.resolve({ count: 0 }),
    // employees still without access → the step leads to /team
    can(session, "hr.view") && can(session, "members.manage")
      ? supabase.from("employees").select("id", { count: "exact", head: true }).eq("organization_id", org.id).is("user_id", null).neq("status", "final_exit")
      : Promise.resolve({ count: 0 }),
    // «عروض تنتظرك»: the clients' answers on their pages (quotes.view)
    can(session, "quotes.view") ? loadQuotesWaiting(session) : Promise.resolve(null),
    // «معاينات قادمة»: booked visits with where to go (clients.view)
    can(session, "clients.view") ? loadUpcomingSurveys(session, today) : Promise.resolve(null),
  ]);
  const team = teamSetupStep({ members: count ?? 1, pendingInvites: pendingInvites ?? 0, employeesWithoutAccess: withoutAccess ?? 0 });
  return (
    <DashboardView
      data={{
        userName: session.profile.full_name,
        finance,
        approvals,
        expiring,
        quotesWaiting,
        upcomingSurveys: upcoming,
        financeActions: { decide: decideFromDashboard, saveCash: saveCashSettings },
        setup: [
          { key: "setupCompany", done: Boolean(org.cr_number && org.vat_number), href: "/settings" },
          { key: "setupLogo", done: Boolean(org.logo_path), href: "/settings/branding" },
          { key: "setupTeam", done: team.done, href: team.href },
          { key: "setupCatalogue", done: finance ? finance.profits.length > 0 : false, href: "/catalogue" },
        ],
      }}
    />
  );
}
