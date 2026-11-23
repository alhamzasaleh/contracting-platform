"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SERVICES = ["gypsum", "interior", "exterior"] as const;

async function authorize() {
  const session = await getSession();
  if (!can(session, "schedule.manage")) return { ok: false, error: "noAccess" } as const;
  return { supabase: await createClient(), orgId: session.organization.id };
}
type Ctx = Exclude<Awaited<ReturnType<typeof authorize>>, { ok: false }>;
const isCtx = (c: Awaited<ReturnType<typeof authorize>>): c is Ctx => !("ok" in c);

function fail(error: { code?: string } | null, what: string): ActionResult<never> {
  console.error(`[schedule] ${what} failed`, { code: error?.code });
  return { ok: false, error: error?.code === "42501" ? "noAccess" : error?.code === "23505" ? "teamExists" : "error" };
}
const done = <T,>(data?: T): ActionResult<T> => {
  revalidatePath("/schedule");
  revalidatePath("/contracts", "layout");
  return { ok: true, data };
};

const teamSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(80),
    kind: z.enum(["inhouse", "external"]),
    services: z.array(z.enum(SERVICES)).max(3),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    contact_phone: z.preprocess((v) => {
      if (typeof v !== "string") return v;
      const d = v.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");
      if (d === "") return null;
      return /^05\d{8}$/.test(d) ? `966${d.slice(1)}` : d;
    }, z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable()),
    is_active: z.boolean(),
    notes: z.string().trim().max(1000).nullable(),
    members: z.array(id).max(100),
  })
  .strict();

export async function saveTeam(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: teamId, members, ...data } = parsed.data;
  const row = { ...data, services: [...new Set(data.services)], notes: data.notes || null };
  const { data: saved, error } = teamId
    ? await ctx.supabase.from("teams").update(row).eq("id", teamId).eq("organization_id", ctx.orgId).select("id").single()
    : await ctx.supabase.from("teams").insert({ ...row, organization_id: ctx.orgId }).select("id").single();
  if (error || !saved) return fail(error, "save team");

  // members: add the new ones, remove the dropped ones
  const { data: current, error: e1 } = await ctx.supabase.from("team_members").select("id, employee_id").eq("team_id", saved.id);
  if (e1) return fail(e1, "read members");
  const want = new Set(members);
  const have = new Set((current ?? []).map((m) => m.employee_id));
  const drop = (current ?? []).filter((m) => !want.has(m.employee_id)).map((m) => m.id);
  const add = [...want].filter((e) => !have.has(e)).map((employee_id) => ({ organization_id: ctx.orgId, team_id: saved.id, employee_id }));
  if (drop.length) {
    const { error: e2 } = await ctx.supabase.from("team_members").delete().in("id", drop);
    if (e2) return fail(e2, "remove members");
  }
  if (add.length) {
    const { error: e3 } = await ctx.supabase.from("team_members").insert(add);
    if (e3) return fail(e3, "add members");
  }
  return done({ id: saved.id });
}

const entrySchema = z
  .object({
    id: id.optional(),
    team_id: id,
    kind: z.enum(["work", "leave", "other"]),
    contract_id: id.nullable(),
    title: z.string().trim().max(160).nullable(),
    start_date: day,
    end_date: day,
    notes: z.string().trim().max(1000).nullable(),
  })
  .strict()
  .refine((e) => e.end_date >= e.start_date, { message: "endBeforeStart", path: ["end_date"] })
  .refine((e) => e.kind !== "work" || e.contract_id, { message: "contractRequired", path: ["contract_id"] });

export async function saveEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: entryId, ...data } = parsed.data;
  const row = { ...data, contract_id: data.kind === "work" ? data.contract_id : null, title: data.title || null, notes: data.notes || null };
  const { data: saved, error } = entryId
    ? await ctx.supabase.from("schedule_entries").update(row).eq("id", entryId).eq("organization_id", ctx.orgId).select("id").single()
    : await ctx.supabase.from("schedule_entries").insert({ ...row, organization_id: ctx.orgId }).select("id").single();
  if (error || !saved) return fail(error, "save entry");
  return done({ id: saved.id });
}

export async function deleteEntry(input: unknown): Promise<ActionResult> {
  const ctx = await authorize();
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("schedule_entries").delete().eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  if (error) return fail(error, "delete entry");
  return done();
}
