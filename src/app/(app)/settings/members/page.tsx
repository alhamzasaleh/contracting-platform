import { MembersView, type InvitationItem, type MemberItem } from "@/components/settings/members-view";
import { effectivePermissions, type PermissionOverrides } from "@/lib/auth/permissions";
import { can, getSession } from "@/lib/auth/session";
import { once, rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";
import { inviteMember, linkMemberEmployee, revokeInvitation, unlinkEmployee, updateMember } from "./actions";

export default async function MembersPage() {
  const session = await getSession();
  const supabase = await createClient();
  const orgId = session.organization.id;

  const manage = can(session, "members.manage");
  const membershipsP = once(
    supabase
      .from("memberships")
      .select("id, user_id, role, status, permission_overrides, project_scope")
      .eq("organization_id", orgId)
      .order("created_at"),
  );
  // one parallel round (+ the members' names, chained onto the memberships)
  const [{ data: memberships }, { data: invitations }, profiles, [{ data: contracts }, { data: assignments }, { data: clients }], employees] = await Promise.all([
    membershipsP,
    manage
      ? supabase
          .from("member_invitations")
          .select("id, phone, full_name, role, expires_at, employee_id")
          .eq("organization_id", orgId)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; phone: string; full_name: string | null; role: InvitationItem["role"]; expires_at: string; employee_id?: string | null }[] }),
    membershipsP.then(({ data }) => {
      const userIds = (data ?? []).map((m) => m.user_id);
      return userIds.length ? rows(supabase.from("profiles").select("id, full_name, phone").in("id", userIds)) : [];
    }),
    // projects to assign (members.manage) and who is assigned where
    manage
      ? Promise.all([
          supabase.from("contracts").select("id, number, client_id, status").eq("organization_id", orgId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(300),
          supabase.from("project_members").select("contract_id, user_id").eq("organization_id", orgId),
          supabase.from("clients").select("id, name").eq("organization_id", orgId),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }, { data: [] }] as const),
    // employees (name, job, phone, account) — linked accounts and invitations; members.manage, never hr data
    manage ? rows(supabase.rpc("member_employee_links", { p_org: orgId })) : Promise.resolve([]),
  ]);
  const employeeOf = (e: { employee_id: string; full_name: string; job_title: string | null; status?: string } | undefined) =>
    e ? { id: e.employee_id, name: e.full_name, job: e.job_title, exited: e.status === "final_exit" } : null;
  const pendingFor = new Set((invitations ?? []).flatMap((i) => (i.employee_id ? [i.employee_id] : [])));
  // an employee without access whose number is this member's account → offer to link them
  const samePhone = (phone: string | null | undefined) =>
    phone ? employees.find((e) => !e.user_id && e.phone === phone && e.status !== "final_exit" && !pendingFor.has(e.employee_id)) : undefined;
  const byUser = new Map(employees.filter((e) => e.user_id).map((e) => [e.user_id!, e]));
  const byEmployee = new Map(employees.map((e) => [e.employee_id, e]));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const clientName = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));

  const members: MemberItem[] = (memberships ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: byId.get(m.user_id)?.full_name ?? null,
    phone: byId.get(m.user_id)?.phone ?? null,
    role: m.role,
    status: m.status,
    permissions: effectivePermissions(m.role, m.permission_overrides as PermissionOverrides),
    isYou: m.user_id === session.userId,
    projectScope: m.project_scope,
    projectIds: (assignments ?? []).filter((a: { user_id: string }) => a.user_id === m.user_id).map((a: { contract_id: string }) => a.contract_id),
    employee: employeeOf(byUser.get(m.user_id)),
    suggestEmployee: byUser.has(m.user_id) ? null : employeeOf(samePhone(byId.get(m.user_id)?.phone)),
  }));

  return (
    <MembersView
      members={members}
      invitations={(invitations ?? []).map((i) => ({ id: i.id, phone: i.phone, name: i.full_name, role: i.role, expiresAt: i.expires_at, employee: employeeOf(i.employee_id ? byEmployee.get(i.employee_id) : undefined) }))}
      employees={employees.filter((e) => !e.user_id && !(invitations ?? []).some((i) => i.employee_id === e.employee_id))}
      canViewHr={can(session, "hr.view")}
      canManage={can(session, "members.manage")}
      isOwner={session.role === "owner"}
      actions={{ invite: inviteMember, update: updateMember, revoke: revokeInvitation, link: linkMemberEmployee, unlink: unlinkEmployee }}
      projects={(contracts ?? []).map((c: { id: string; number: string; client_id: string }) => ({ id: c.id, number: c.number, client: clientName.get(c.client_id) ?? "—" }))}
    />
  );
}
