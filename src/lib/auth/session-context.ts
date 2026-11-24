import type { MembershipRow, OrganizationRow, ProfileRow } from "@/lib/supabase/database.types";
import { isPermission, type Permission, type Role } from "./permissions";

// Pure helpers for getSession() (no I/O, unit-tested).

/** The organization a session works in: the profile's default when he is an active member there, else the first membership. */
export function pickOrganization(memberships: { organization_id: string }[], defaultOrg: string | null | undefined): string | null {
  return memberships.find((m) => m.organization_id === defaultOrg)?.organization_id ?? memberships[0]?.organization_id ?? null;
}

export type SessionParts = {
  profile: ProfileRow | null;
  memberships: Pick<MembershipRow, "organization_id" | "role">[];
  organization: OrganizationRow | null;
  permissions: Permission[];
};

/** Reads public.session_context()'s JSON (null / malformed → null, so the caller falls back to separate queries). */
export function parseSessionContext(raw: unknown): SessionParts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.memberships)) return null;
  const memberships = (r.memberships as unknown[])
    .filter((m): m is { organization_id: string; role: Role } => !!m && typeof m === "object" && typeof (m as { organization_id?: unknown }).organization_id === "string")
    .map((m) => ({ organization_id: m.organization_id, role: m.role }));
  return {
    profile: r.profile && typeof r.profile === "object" ? (r.profile as ProfileRow) : null,
    memberships,
    organization: r.organization && typeof r.organization === "object" ? (r.organization as OrganizationRow) : null,
    permissions: (Array.isArray(r.permissions) ? (r.permissions as unknown[]) : []).filter((p): p is Permission => typeof p === "string" && isPermission(p)),
  };
}

