import { DashboardView } from "@/components/dashboard/dashboard-view";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const session = await getSession();
  const supabase = await createClient();
  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", session.organization.id);

  const org = session.organization;
  return (
    <DashboardView
      data={{
        userName: session.profile.full_name,
        setup: [
          { key: "setupCompany", done: Boolean(org.cr_number && org.vat_number), href: "/settings" },
          { key: "setupLogo", done: Boolean(org.logo_path), href: "/settings/branding" },
          { key: "setupTeam", done: (count ?? 1) > 1, href: "/settings/members" },
          { key: "setupCatalogue", done: false },
        ],
      }}
    />
  );
}
