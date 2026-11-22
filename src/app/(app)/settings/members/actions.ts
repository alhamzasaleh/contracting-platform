"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { can, getSession } from "@/lib/auth/session";
import type { MembershipRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { saudiMobileSchema } from "@/lib/validation/phone";

const inviteSchema = z
  .object({
    phone: saudiMobileSchema,
    full_name: z.string().trim().max(120).optional(),
    role: z.enum(["supervisor", "finance", "viewer"]),
  })
  .strict();

export async function inviteMember(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.from("member_invitations").insert({
    organization_id: session.organization.id,
    phone: parsed.data.phone,
    full_name: parsed.data.full_name || null,
    role: parsed.data.role,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "duplicate" : error.code === "42501" ? "noAccess" : "error" };
  revalidatePath("/settings/members");
  return { ok: true };
}

const memberUpdateSchema = z
  .object({
    membershipId: z.uuid(),
    role: z.enum(["owner", "supervisor", "finance", "viewer"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).optional(),
  })
  .strict();

export async function updateMember(input: z.input<typeof memberUpdateSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = memberUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { membershipId, role, status, permissions } = parsed.data;

  const supabase = await createClient();
  const patch: Partial<MembershipRow> = {};
  if (role) patch.role = role;
  if (status) patch.status = status;

  if (permissions) {
    // Store the difference from the role defaults as grant/deny overrides.
    const { data: current } = await supabase
      .from("memberships")
      .select("role")
      .eq("id", membershipId)
      .eq("organization_id", session.organization.id)
      .single();
    if (!current) return { ok: false, error: "notFound" };
    const base = new Set<Permission>(ROLE_PERMISSIONS[(role ?? current.role) as Role]);
    const wanted = new Set<Permission>(permissions);
    patch.permission_overrides = {
      grant: PERMISSIONS.filter((p) => wanted.has(p) && !base.has(p)),
      deny: PERMISSIONS.filter((p) => !wanted.has(p) && base.has(p)),
    };
  }

  if (Object.keys(patch).length === 0) return { ok: true };

  const { data, error } = await supabase
    .from("memberships")
    .update(patch)
    .eq("id", membershipId)
    .eq("organization_id", session.organization.id)
    .select("id");
  if (error) {
    if (error.message.includes("at least one active owner")) return { ok: false, error: "lastOwner" };
    if (error.code === "42501") return { ok: false, error: "noAccess" };
    return { ok: false, error: "error" };
  }
  if (!data?.length) return { ok: false, error: "noAccess" };
  revalidatePath("/settings/members");
  return { ok: true };
}

const revokeSchema = z.object({ invitationId: z.uuid() }).strict();

export async function revokeInvitation(input: z.input<typeof revokeSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.invitationId)
    .eq("organization_id", session.organization.id);
  if (error) return { ok: false, error: "error" };
  revalidatePath("/settings/members");
  return { ok: true };
}
