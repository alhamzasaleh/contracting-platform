import { MembersView, type InvitationItem, type MemberItem } from "@/components/settings/members-view";
import { effectivePermissions, type PermissionOverrides } from "@/lib/auth/permissions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { inviteMember, revokeInvitation, updateMember } from "./actions";

export default async function MembersPage() {
  const session = await getSession();
  const supabase = await createClient();
  const orgId = session.organization.id;

  const [{ data: memberships }, { data: invitations }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, status, permission_overrides")
      .eq("organization_id", orgId)
      .order("created_at"),
    can(session, "members.manage")
      ? supabase
          .from("member_invitations")
          .select("id, phone, full_name, role, expires_at")
          .eq("organization_id", orgId)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { id: string; phone: string; full_name: string | null; role: InvitationItem["role"]; expires_at: string }[] }),
  ]);

  const userIds = (memberships ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, phone").in("id", userIds)
    : { data: [] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  const members: MemberItem[] = (memberships ?? []).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: byId.get(m.user_id)?.full_name ?? null,
    phone: byId.get(m.user_id)?.phone ?? null,
    role: m.role,
    status: m.status,
    permissions: effectivePermissions(m.role, m.permission_overrides as PermissionOverrides),
    isYou: m.user_id === session.userId,
  }));

  return (
    <MembersView
      members={members}
      invitations={(invitations ?? []).map((i) => ({ id: i.id, phone: i.phone, name: i.full_name, role: i.role, expiresAt: i.expires_at }))}
      canManage={can(session, "members.manage")}
      isOwner={session.role === "owner"}
      actions={{ invite: inviteMember, update: updateMember, revoke: revokeInvitation }}
    />
  );
}
