"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/auth/permissions";
import { can, getSession } from "@/lib/auth/session";
import type { MembershipRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { inviteError } from "@/lib/hr/access";
import { saudiMobileSchema } from "@/lib/validation/phone";

const inviteSchema = z
  .object({
    phone: saudiMobileSchema,
    full_name: z.string().trim().max(120).optional(),
    role: z.enum(["supervisor", "finance", "viewer"]),
    /** the invitation is for this employee: the database links his record to the account on acceptance */
    employee_id: z.uuid().optional(),
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
    employee_id: parsed.data.employee_id ?? null,
  });
  if (error) return { ok: false, error: inviteError(error) };
  revalidatePath("/settings/members");
  revalidatePath("/team");
  return { ok: true };
}

const memberUpdateSchema = z
  .object({
    membershipId: z.uuid(),
    role: z.enum(["owner", "supervisor", "finance", "viewer"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).optional(),
    project_scope: z.enum(["all", "assigned"]).optional(),
    contract_ids: z.array(z.uuid()).max(500).optional(),
  })
  .strict();

export async function updateMember(input: z.input<typeof memberUpdateSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = memberUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { membershipId, role, status, permissions, project_scope, contract_ids } = parsed.data;

  const supabase = await createClient();
  const patch: Partial<MembershipRow> = {};
  if (role) patch.role = role;
  if (status) patch.status = status;
  if (project_scope) patch.project_scope = project_scope;

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

  // which projects an "assigned" member sees (RLS: members.manage only)
  if (contract_ids) {
    const { data: m } = await supabase.from("memberships").select("user_id").eq("id", membershipId).eq("organization_id", session.organization.id).maybeSingle();
    if (!m) return { ok: false, error: "notFound" };
    const { data: current } = await supabase.from("project_members").select("contract_id").eq("user_id", m.user_id).eq("organization_id", session.organization.id);
    const have = new Set((current ?? []).map((x) => x.contract_id));
    const want = new Set(contract_ids);
    const remove = [...have].filter((c) => !want.has(c));
    const add = [...want].filter((c) => !have.has(c));
    if (remove.length) {
      const { error } = await supabase.from("project_members").delete().eq("user_id", m.user_id).in("contract_id", remove);
      if (error) return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
    }
    if (add.length) {
      const { error } = await supabase.from("project_members").insert(add.map((contract_id) => ({ organization_id: session.organization.id, contract_id, user_id: m.user_id })));
      if (error) return { ok: false, error: error.code === "42501" ? "noAccess" : "error" };
    }
  }

  if (Object.keys(patch).length === 0) {
    revalidatePath("/settings/members");
    return { ok: true };
  }

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
  revalidatePath("/team");
  return { ok: true };
}

const linkSchema = z.object({ employee_id: z.uuid(), user_id: z.uuid() }).strict();

/** Link an existing member to the employee whose number is his account's (members.manage; the database checks it all). */
export async function linkMemberEmployee(input: z.input<typeof linkSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("link_member_employee", { p_employee: parsed.data.employee_id, p_user: parsed.data.user_id });
  if (error) return { ok: false, error: inviteError(error) };
  revalidatePath("/settings/members");
  revalidatePath("/team");
  return { ok: true };
}

const unlinkSchema = z.object({ employee_id: z.uuid() }).strict();

/** Unlink an employee from his account (members.manage); he can be invited again. */
export async function unlinkEmployee(input: z.input<typeof unlinkSchema>): Promise<ActionResult> {
  const session = await getSession();
  if (!can(session, "members.manage")) return { ok: false, error: "noAccess" };
  const parsed = unlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlink_employee_account", { p_employee: parsed.data.employee_id });
  if (error) return { ok: false, error: inviteError(error) };
  revalidatePath("/settings/members");
  revalidatePath("/team");
  return { ok: true };
}
