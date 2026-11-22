"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { MATERIAL_UNITS } from "@/lib/supabase/database.types";
import { num, optionalDate, optionalNum, optionalText } from "@/lib/validation/numbers";

type Ctx = { orgId: string; supabase: Awaited<ReturnType<typeof createClient>> };

async function authorize(...perms: Permission[]): Promise<Ctx | ActionResult> {
  const session = await getSession();
  if (!perms.every((p) => can(session, p))) return { ok: false, error: "noAccess" };
  return { orgId: session.organization.id, supabase: await createClient() };
}
const isCtx = (x: Ctx | ActionResult): x is Ctx => "orgId" in x;

function dbError(error: { code?: string; message: string } | null): ActionResult | null {
  if (!error) return null;
  if (error.code === "23505") return { ok: false, error: "duplicate" };
  if (error.code === "42501") return { ok: false, error: "noAccess" };
  if (error.code === "23503") return { ok: false, error: "inUse" };
  console.error("[catalogue] db error", { code: error.code, message: error.message });
  return { ok: false, error: "error" };
}

function done(paths: string[] = ["/catalogue"]): ActionResult {
  for (const p of paths) revalidatePath(p, "layout");
  return { ok: true };
}

const id = z.uuid();

// --- Starter catalogue -------------------------------------------------------

export async function seedCatalogue(): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const { error } = await ctx.supabase.rpc("seed_starter_catalogue", { p_org: ctx.orgId });
  return dbError(error) ?? done();
}

// --- Services -----------------------------------------------------------------

const serviceSchema = z
  .object({
    id: id.optional(),
    name_ar: z.string().trim().min(2, "required").max(120),
    name_en: optionalText(120),
    description: optionalText(2000),
    unit: z.enum(["m2", "m", "piece", "lump"]),
    waste_percent: optionalNum({ min: 0, max: 100 }),
    is_active: z.boolean(),
  })
  .strict();

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export async function saveService(input: unknown): Promise<ActionResult<{ code: string }>> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: serviceId, ...data } = parsed.data;

  if (serviceId) {
    const { data: row, error } = await ctx.supabase
      .from("services")
      .update(data)
      .eq("id", serviceId)
      .eq("organization_id", ctx.orgId)
      .select("code")
      .single();
    const err = dbError(error);
    if (err) return err;
    done();
    return { ok: true, data: { code: row!.code } };
  }

  const base = slugify(data.name_en ?? "") || "service";
  const code = `${base.length >= 2 ? base : "service"}-${Date.now().toString(36).slice(-4)}`;
  const { error } = await ctx.supabase.from("services").insert({ ...data, code, organization_id: ctx.orgId });
  const err = dbError(error);
  if (err) return err;
  done();
  return { ok: true, data: { code } };
}

// --- Stages -------------------------------------------------------------------

const stageSchema = z
  .object({
    id: id.optional(),
    service_id: id,
    kind: z.enum(["prep", "work", "handover"]),
    name_ar: z.string().trim().min(2, "required").max(120),
    productivity_per_day: optionalNum({ min: 0.01, max: 100000 }),
    fixed_days: num({ min: 0, max: 365 }),
    notes: optionalText(1000),
  })
  .strict();

export async function saveStage(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = stageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: stageId, ...data } = parsed.data;
  if (stageId) {
    const { error } = await ctx.supabase.from("service_stages").update(data).eq("id", stageId).eq("organization_id", ctx.orgId);
    return dbError(error) ?? done();
  }
  const { data: last } = await ctx.supabase
    .from("service_stages")
    .select("sort_order")
    .eq("service_id", data.service_id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const { error } = await ctx.supabase
    .from("service_stages")
    .insert({ ...data, organization_id: ctx.orgId, sort_order: (last?.[0]?.sort_order ?? 0) + 1 });
  return dbError(error) ?? done();
}

export async function moveStage(input: { id: string; direction: "up" | "down" }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id, direction: z.enum(["up", "down"]) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data: stage } = await ctx.supabase.from("service_stages").select("id, service_id").eq("id", parsed.data.id).single();
  if (!stage) return { ok: false, error: "notFound" };
  const { data: all } = await ctx.supabase
    .from("service_stages")
    .select("id")
    .eq("service_id", stage.service_id)
    .order("sort_order")
    .order("created_at");
  const ids = (all ?? []).map((s) => s.id);
  const i = ids.indexOf(stage.id);
  const j = parsed.data.direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (let k = 0; k < ids.length; k++) {
    const { error } = await ctx.supabase.from("service_stages").update({ sort_order: k + 1 }).eq("id", ids[k]);
    if (error) return dbError(error)!;
  }
  return done();
}

export async function deleteStage(input: { id: string }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  if (!id.safeParse(input.id).success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("service_stages").delete().eq("id", input.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Spec templates -----------------------------------------------------------

const specSchema = z
  .object({
    id: id.optional(),
    service_id: id,
    title: z.string().trim().min(2, "required").max(120),
    body: z.string().trim().min(2, "required").max(4000),
    is_default: z.boolean(),
  })
  .strict();

export async function saveSpec(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: specId, ...data } = parsed.data;
  if (data.is_default) {
    await ctx.supabase.from("spec_templates").update({ is_default: false }).eq("service_id", data.service_id).eq("organization_id", ctx.orgId);
  }
  const { error } = specId
    ? await ctx.supabase.from("spec_templates").update(data).eq("id", specId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("spec_templates").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

export async function deleteSpec(input: { id: string }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  if (!id.safeParse(input.id).success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("spec_templates").delete().eq("id", input.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Recipes ------------------------------------------------------------------

const recipeSchema = z
  .object({
    id: id.optional(),
    service_id: id,
    material_id: id,
    calc_mode: z.enum(["fixed", "coverage"]),
    coats: num({ min: 0.1, max: 20 }),
    qty_per_unit: optionalNum({ min: 0.0001, max: 100000 }),
    waste_percent: optionalNum({ min: 0, max: 100 }),
    notes: optionalText(500),
  })
  .strict()
  .refine((d) => d.calc_mode === "coverage" || d.qty_per_unit != null, { path: ["qty_per_unit"], message: "required" });

export async function saveRecipeLine(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: lineId, ...data } = parsed.data;
  const { error } = lineId
    ? await ctx.supabase.from("service_material_recipes").update(data).eq("id", lineId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("service_material_recipes").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

export async function deleteRecipeLine(input: { id: string }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  if (!id.safeParse(input.id).success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("service_material_recipes").delete().eq("id", input.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Materials & prices -------------------------------------------------------

const materialSchema = z
  .object({
    id: id.optional(),
    name_ar: z.string().trim().min(2, "required").max(160),
    name_en: optionalText(160),
    category: optionalText(60),
    unit: z.enum(MATERIAL_UNITS),
    scope: z.enum(["general", "project"]),
    sku: optionalText(60),
    brand: optionalText(80),
    package_desc: optionalText(80),
    coverage_per_unit: optionalNum({ min: 0.0001, max: 100000 }),
    preferred_supplier_id: z.preprocess((v) => (v === "" ? null : v), id.nullable()),
    is_active: z.boolean(),
    initial_price: optionalNum({ min: 0, max: 10_000_000 }).optional(),
  })
  .strict();

export async function saveMaterial(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = materialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: materialId, initial_price, ...data } = parsed.data;
  if (materialId) {
    const { error } = await ctx.supabase.from("materials").update(data).eq("id", materialId).eq("organization_id", ctx.orgId);
    return dbError(error) ?? done();
  }
  const { data: row, error } = await ctx.supabase
    .from("materials")
    .insert({ ...data, organization_id: ctx.orgId })
    .select("id")
    .single();
  const err = dbError(error);
  if (err) return err;
  if (initial_price != null && row) {
    const session = await getSession();
    if (can(session, "costs.view")) {
      const { error: pErr } = await ctx.supabase.from("material_prices").insert({
        organization_id: ctx.orgId,
        material_id: row.id,
        unit_price: initial_price,
        supplier_id: data.preferred_supplier_id ?? null,
      });
      if (pErr) return dbError(pErr)!;
    }
  }
  return done();
}

const priceSchema = z
  .object({
    material_id: id,
    unit_price: num({ min: 0, max: 10_000_000 }),
    effective_from: optionalDate,
    source: optionalText(160),
    supplier_id: z.preprocess((v) => (v === "" ? null : v), id.nullable()),
  })
  .strict();

export async function addMaterialPrice(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { effective_from, ...rest } = parsed.data;
  const { error } = await ctx.supabase.from("material_prices").insert({
    ...rest,
    ...(effective_from ? { effective_from } : {}),
    organization_id: ctx.orgId,
  });
  return dbError(error) ?? done();
}

// --- Labour rates & extra costs ----------------------------------------------

const labourSchema = z
  .object({
    id: id.optional(),
    service_id: id.nullable(),
    name: z.string().trim().min(2, "required").max(120),
    basis: z.enum(["external_per_unit", "external_lump"]),
    rate: num({ min: 0, max: 10_000_000 }),
    notes: optionalText(500),
    is_active: z.boolean(),
  })
  .strict();

export async function saveLabourRate(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = labourSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: rowId, ...data } = parsed.data;
  const { error } = rowId
    ? await ctx.supabase.from("labour_rates").update(data).eq("id", rowId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("labour_rates").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

export async function deleteLabourRate(input: { id: string }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  if (!id.safeParse(input.id).success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("labour_rates").delete().eq("id", input.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

const extraSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(120),
    unit: z.enum(["lump", "day", "trip", "month"]),
    default_amount: num({ min: 0, max: 10_000_000 }),
    is_active: z.boolean(),
  })
  .strict();

export async function saveExtraCost(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: rowId, ...data } = parsed.data;
  const { error } = rowId
    ? await ctx.supabase.from("extra_cost_items").update(data).eq("id", rowId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("extra_cost_items").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

export async function deleteExtraCost(input: { id: string }): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  if (!id.safeParse(input.id).success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("extra_cost_items").delete().eq("id", input.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Pricing settings ---------------------------------------------------------

const settingsSchema = z
  .object({
    overhead_percent: num({ min: 0, max: 100 }),
    min_margin_percent: num({ min: 0, max: 100 }),
    default_margin_percent: num({ min: 0, max: 100 }),
    vat_percent: num({ min: 0, max: 100 }),
    default_waste_percent: num({ min: 0, max: 100 }),
    default_warranty_months: num({ min: 0, max: 120 }).pipe(z.number().int("integer")),
    purchase_approval_limit: optionalNum({ min: 0, max: 100_000_000 }),
    working_days_per_month: num({ min: 1, max: 31 }),
    first_payment_material_cover_percent: num({ min: 0, max: 100 }),
  })
  .strict()
  .refine((d) => d.default_margin_percent >= d.min_margin_percent, { path: ["default_margin_percent"], message: "belowMin" });

export async function savePricingSettings(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { error } = await ctx.supabase
    .from("pricing_settings")
    .upsert({ ...parsed.data, organization_id: ctx.orgId }, { onConflict: "organization_id" });
  return dbError(error) ?? done();
}

// --- Suppliers ----------------------------------------------------------------

const supplierSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(160),
    contact_name: optionalText(120),
    phone: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "") || null : v),
      z.string().regex(/^\d{8,15}$/, "phoneInvalid").nullable(),
    ),
    vat_number: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s/g, "") || null : v),
      z.string().regex(/^3\d{13}3$/, "vatInvalid").nullable(),
    ),
    city: optionalText(80),
    notes: optionalText(1000),
    is_active: z.boolean(),
  })
  .strict();

export async function saveSupplier(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: supplierId, ...data } = parsed.data;
  const { error } = supplierId
    ? await ctx.supabase.from("suppliers").update(data).eq("id", supplierId).eq("organization_id", ctx.orgId)
    : await ctx.supabase.from("suppliers").insert({ ...data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}
