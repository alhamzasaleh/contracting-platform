import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { MembershipRow, OrganizationRow, ProfileRow } from "@/lib/supabase/database.types";
import { isPermission, type Permission, type Role } from "./permissions";
import { parseSessionContext, pickOrganization, type SessionParts } from "./session-context";

export type SessionContext = {
  userId: string;
  phone: string | null;
  profile: ProfileRow;
  organization: OrganizationRow;
  role: Role;
  permissions: Permission[];
  memberships: Pick<MembershipRow, "organization_id" | "role">[];
};

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The same four things as session_context(), with separate queries (used only if the function isn't deployed yet). */
async function loadSessionParts(supabase: Supabase, userId: string): Promise<SessionParts> {
  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase.from("memberships").select("organization_id, role").eq("user_id", userId).eq("status", "active"),
  ]);
  const orgId = pickOrganization(memberships ?? [], profile?.default_organization_id);
  if (!profile || !orgId) return { profile, memberships: memberships ?? [], organization: null, permissions: [] };
  const [{ data: organization }, { data: perms }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", orgId).single(),
    supabase.rpc("my_permissions", { p_org: orgId }),
  ]);
  return { profile, memberships: memberships ?? [], organization, permissions: (perms ?? []).filter(isPermission) };
}

/**
 * Data Access Layer entry point. Verifies the user's JWT (signature + expiry — locally
 * against the project's signing keys, or with Supabase Auth for legacy symmetric keys),
 * then loads profile, memberships, current organization and effective permissions in one
 * round trip (public.session_context, security invoker: the same RLS as separate queries).
 * Every query still carries the user's JWT, so the database enforces RLS itself. Cached per request.
 */
export const getSession = cache(async (): Promise<SessionContext> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims?.sub) redirect("/login");
  const userId = claims.sub;

  const { data: raw, error } = await supabase.rpc("session_context");
  // null = no profile; an error (function not deployed yet) or an unreadable answer → the separate queries
  const parts = !error && raw == null ? null : ((!error ? parseSessionContext(raw) : null) ?? (await loadSessionParts(supabase, userId)));
  if (!parts?.profile) redirect("/login");
  const { profile, memberships } = parts;
  if (memberships.length === 0) redirect("/onboarding");
  const orgId = pickOrganization(memberships, profile.default_organization_id)!;
  const organization = parts.organization;
  if (!organization || organization.id !== orgId) redirect("/onboarding");

  return {
    userId,
    phone: typeof claims.phone === "string" && claims.phone ? claims.phone : null,
    profile,
    organization,
    role: memberships.find((m) => m.organization_id === orgId)!.role,
    permissions: parts.permissions,
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
