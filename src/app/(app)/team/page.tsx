import { EmployeesView } from "@/components/team/employees-view";
import { can, getSession } from "@/lib/auth/session";
import { loadPricingSettings } from "@/lib/data/catalogue";
import { rows } from "@/lib/data/query";
import { loadCostItems } from "@/lib/data/team";
import type { AccessInvite, AccessMember } from "@/lib/hr/access";
import { createClient } from "@/lib/supabase/server";
import { inviteMember, linkMemberEmployee, revokeInvitation, unlinkEmployee } from "../settings/members/actions";
import { saveEmployee } from "./actions";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const session = await getSession();
  const supabase = await createClient();
  const orgId = session.organization.id;
  // sign-in access per employee: only for who manages members (invitations are members.manage)
  const manageMembers = can(session, "members.manage");
  const [{ data: employees }, costItems, settings, members, invites, { employee: focus }] = await Promise.all([
    supabase.from("employees").select("*").eq("organization_id", orgId).order("status").order("full_name"),
    loadCostItems(session),
    loadPricingSettings(session),
    // members with their account's number (an employee with that number is linked, not invited)
    manageMembers
      ? rows(supabase.from("memberships").select("user_id, role, status").eq("organization_id", orgId)).then(async (ms) => {
          const phones = ms.length ? await rows(supabase.from("profiles").select("id, phone").in("id", ms.map((m) => m.user_id))) : [];
          const phoneOf = new Map(phones.map((p) => [p.id, p.phone]));
          return ms.map((m) => ({ ...m, phone: phoneOf.get(m.user_id) ?? null }));
        })
      : Promise.resolve([]),
    manageMembers
      ? rows(
          supabase
            .from("member_invitations")
            .select("id, employee_id, role, phone")
            .eq("organization_id", orgId)
            .not("employee_id", "is", null)
            .is("accepted_at", null)
            .is("revoked_at", null)
            .gt("expires_at", new Date().toISOString()),
        )
      : Promise.resolve([]),
    searchParams,
  ]);
  const num = (v: unknown) => Number(v ?? 0);
  return (
    <EmployeesView
      employees={(employees ?? []).map((e) => ({
        ...e,
        basic_salary: num(e.basic_salary),
        housing_allowance: num(e.housing_allowance),
        transport_allowance: num(e.transport_allowance),
        other_allowances: num(e.other_allowances),
      }))}
      costItems={costItems}
      workingDays={Number(settings?.working_days_per_month ?? 26)}
      canManage={can(session, "hr.manage")}
      onSave={saveEmployee}
      focus={typeof focus === "string" && /^[0-9a-f-]{36}$/i.test(focus) ? focus : undefined}
      access={
        manageMembers
          ? {
              members: members.map((m): AccessMember => ({ userId: m.user_id, role: m.role, status: m.status, phone: m.phone })),
              invites: invites.map((i): AccessInvite => ({ id: i.id, employeeId: i.employee_id ?? null, role: i.role, phone: i.phone })),
              isOwner: session.role === "owner",
              invite: inviteMember,
              revoke: revokeInvitation,
              link: linkMemberEmployee,
              unlink: unlinkEmployee,
            }
          : undefined
      }
    />
  );
}
