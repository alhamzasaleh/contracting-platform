import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { MembershipRow, OrganizationRow, ProfileRow } from "@/lib/supabase/database.types";
import { isPermission, type Permission, type Role } from "./permissions";

export type SessionContext = {
  userId: string;
  phone: string | null;
  profile: ProfileRow;
  organization: OrganizationRow;
  role: Role;
  permissions: Permission[];
  memberships: Pick<MembershipRow, "organization_id" | "role">[];
};

/**
 * Data Access Layer entry point. Verifies the user with Supabase Auth
 * (server-side JWT validation), loads their profile, current organization
 * and effective permissions. Cached per request.
 */
export const getSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", auth.user.id).single(),
    supabase
      .from("memberships")
      .select("organization_id, role")
      .eq("user_id", auth.user.id)
      .eq("status", "active"),
  ]);

  if (!profile) redirect("/login");
  if (!memberships || memberships.length === 0) redirect("/onboarding");

  const orgId =
    memberships.find((m) => m.organization_id === profile.default_organization_id)?.organization_id ??
    memberships[0].organization_id;

  const [{ data: organization }, { data: perms }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).single(),
    supabase.rpc("my_permissions", { p_org: orgId }),
  ]);
  if (!organization) redirect("/onboarding");

  return {
    userId: auth.user.id,
    phone: auth.user.phone ?? null,
    profile,
    organization,
    role: memberships.find((m) => m.organization_id === orgId)!.role,
    permissions: (perms ?? []).filter(isPermission),
    memberships,
  };
});

export function can(session: Pick<SessionContext, "permissions">, permission: Permission) {
  return session.permissions.includes(permission);
}

/** For pages: 404-style refusal if the permission is missing. */
export async function requirePermission(permission: Permission) {
  const session = await getSession();
  if (!can(session, permission)) redirect("/?denied=1");
  return session;
}
