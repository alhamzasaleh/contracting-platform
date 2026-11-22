"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors, type ActionResult } from "@/lib/actions";
import { can, getSession } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { familyOf, PRODUCT_CATEGORIES, PURCHASE_UNITS, type ProductRow } from "@/lib/supabase/database.types";
import { CATEGORY_SPEC, DEFAULT_ROLE, firstPackSize, missingFields, normaliseProductFields } from "@/lib/catalogue/product-kinds";
import { num, optionalNum, optionalText } from "@/lib/validation/numbers";

/** Server actions for the pricing-engine catalogue (Appendix A). */

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
  console.error("[engine-catalogue] db error", { code: error.code, message: error.message });
  return { ok: false, error: "error" };
}

function done(): ActionResult {
  revalidatePath("/catalogue", "layout");
  return { ok: true };
}

const id = z.uuid();
const optionalId = z.preprocess((v) => (v === "" || v === undefined ? null : v), id.nullable());

export async function seedPricingEngine(): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  // Services first so systems can link to them (both are idempotent).
  const s = await ctx.supabase.rpc("seed_starter_catalogue", { p_org: ctx.orgId });
  if (s.error) return dbError(s.error)!;
  const { error } = await ctx.supabase.rpc("seed_pricing_engine", { p_org: ctx.orgId });
  return dbError(error) ?? done();
}

// --- Products -------------------------------------------------------------------

const productSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(160),
    brand_id: optionalId,
    new_brand: optionalText(80),
    equivalence_group_id: optionalId,
    category: z.enum(PRODUCT_CATEGORIES),
    // Derived from the category on save; accepted for compatibility.
    purchase_unit: z.enum(PURCHASE_UNITS).optional().default("piece"),
    ref_pack_size: optionalNum({ min: 0.0001, max: 100000 }),
    coverage_per_pack: optionalNum({ min: 0.0001, max: 100000 }),
    surface_factor: num({ min: 0.1, max: 2 }),
    length_m: optionalNum({ min: 0.01, max: 100 }),
    contents_per_pack: optionalNum({ min: 0.001, max: 1000000 }),
    area_m2: optionalNum({ min: 0.01, max: 100 }),
    colour_specific: z.boolean(),
    application: z.enum(["interior", "exterior", "both"]),
    waste_percent: optionalNum({ min: 0, max: 100 }),
    notes: optionalText(1000),
    is_active: z.boolean(),
    // first pack + price when creating
    initial_pack_size: optionalNum({ min: 0.0001, max: 100000 }),
    initial_pack_label: optionalText(40),
    initial_price: optionalNum({ min: 0, max: 10_000_000 }),
    initial_supplier_id: optionalId,
  })
  .strict()
  .superRefine((v, c) => {
    // The engine needs these to price the product (pack size + coverage for paint, length for bars…).
    for (const k of missingFields(v.category, normaliseProductFields(v.category, v))) c.addIssue({ code: "custom", path: [k], message: "required" });
  });

export async function saveProduct(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: productId, new_brand, initial_pack_size, initial_pack_label, initial_price, initial_supplier_id, ...raw } = parsed.data;
  // Only the fields that belong to this kind of product are kept.
  const data = normaliseProductFields(raw.category, raw);
  // Without a role the calculation can't use the product — fill the category's default.
  if (!data.equivalence_group_id && DEFAULT_ROLE[data.category]) {
    const { data: g } = await ctx.supabase
      .from("equivalence_groups")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .eq("role", DEFAULT_ROLE[data.category]!)
      .maybeSingle();
    data.equivalence_group_id = g?.id ?? null;
  }

  if (new_brand) {
    // A new brand supplies this product's family (paint / gypsum / other) — not everything.
    const fam = familyOf(data.category);
    const { data: existing } = await ctx.supabase
      .from("brands")
      .select("id, families")
      .eq("organization_id", ctx.orgId)
      .eq("name", new_brand)
      .maybeSingle();
    if (existing) {
      if (!existing.families.includes(fam)) {
        const { error } = await ctx.supabase.from("brands").update({ families: [...existing.families, fam] }).eq("id", existing.id);
        if (error) return dbError(error)!;
      }
      data.brand_id = existing.id;
    } else {
      const { data: b, error } = await ctx.supabase
        .from("brands")
        .insert({ organization_id: ctx.orgId, name: new_brand, families: [fam] })
        .select("id")
        .single();
      if (error) return dbError(error)!;
      data.brand_id = b.id;
    }
  }

  if (productId) {
    const { error } = await ctx.supabase.from("products").update(data).eq("id", productId).eq("organization_id", ctx.orgId);
    return dbError(error) ?? done();
  }

  const { data: row, error } = await ctx.supabase.from("products").insert({ ...data, organization_id: ctx.orgId }).select("id").single();
  if (error) return dbError(error)!;
  const size = initial_pack_size ?? firstPackSize(data.category, data);
  if (size) {
    const { data: pack, error: e2 } = await ctx.supabase
      .from("product_packs")
      .insert({ organization_id: ctx.orgId, product_id: row.id, size, label: initial_pack_label ?? null })
      .select("id")
      .single();
    if (e2) return dbError(e2)!;
    if (initial_price != null) {
      const session = await getSession();
      if (can(session, "costs.view")) {
        const { error: e3 } = await ctx.supabase.from("product_prices").insert({
          organization_id: ctx.orgId,
          product_id: row.id,
          pack_id: pack.id,
          supplier_id: initial_supplier_id,
          unit_price: initial_price,
        });
        if (e3) return dbError(e3)!;
      }
    }
  }
  return done();
}

// --- Product lines (owner's model: product once → brands → packs & prices) --------

const lineSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(2, "required").max(120),
    category: z.enum(PRODUCT_CATEGORIES),
    coverage_per_unit: optionalNum({ min: 0.0001, max: 100000 }),
    length_m: optionalNum({ min: 0.01, max: 100 }),
    contents_per_pack: optionalNum({ min: 0.001, max: 1000000 }),
    area_m2: optionalNum({ min: 0.01, max: 100 }),
    colour_specific: z.boolean(),
    waste_percent: optionalNum({ min: 0, max: 100 }),
  })
  .strict()
  .superRefine((v, c) => {
    const kind = CATEGORY_SPEC[v.category].kind;
    const need = kind === "coverage" ? "coverage_per_unit" : kind === "bar" ? "length_m" : kind === "contents" ? "contents_per_pack" : kind === "board" ? "area_m2" : null;
    if (need && v[need] == null) c.addIssue({ code: "custom", path: [need], message: "required" });
  });

/** Creates or edits a product (its type and coverage — shared by all its brands). */
export async function saveLine(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = lineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: lineId, ...v } = parsed.data;
  const kind = CATEGORY_SPEC[v.category].kind;
  const data = {
    name: v.name,
    category: v.category,
    purchase_unit: CATEGORY_SPEC[v.category].unit,
    coverage_per_unit: kind === "coverage" ? v.coverage_per_unit : null,
    length_m: kind === "bar" ? v.length_m : null,
    contents_per_pack: kind === "contents" ? v.contents_per_pack : null,
    area_m2: kind === "board" ? v.area_m2 : null,
    colour_specific: kind === "coverage" ? v.colour_specific : false,
    waste_percent: v.waste_percent,
  };
  if (lineId) {
    const { error } = await ctx.supabase.from("equivalence_groups").update(data).eq("id", lineId).eq("organization_id", ctx.orgId);
    return dbError(error) ?? done();
  }
  // A new product takes its category's pricing line when that line doesn't exist yet;
  // otherwise it's an extra product the owner keeps for reference.
  const role = DEFAULT_ROLE[v.category];
  const { data: existing } = role
    ? await ctx.supabase.from("equivalence_groups").select("id").eq("organization_id", ctx.orgId).eq("role", role).maybeSingle()
    : { data: null };
  if (existing) return { ok: false, error: "lineExists" };
  const { error } = await ctx.supabase.from("equivalence_groups").insert({
    ...data,
    organization_id: ctx.orgId,
    role: role ?? `custom_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
  });
  return dbError(error) ?? done();
}

const addBrandSchema = z
  .object({
    line_id: id,
    brand_id: optionalId,
    new_brand: optionalText(80),
    pack_size: optionalNum({ min: 0.0001, max: 100000 }),
    pack_label: optionalText(40),
    unit_price: optionalNum({ min: 0, max: 10_000_000 }),
    supplier_id: optionalId,
    coverage_per_unit: optionalNum({ min: 0.0001, max: 100000 }),
  })
  .strict();

/** Adds a brand under a product, with its first pack size and price. */
export async function addBrandToLine(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = addBrandSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { data: line } = await ctx.supabase.from("equivalence_groups").select("*").eq("id", v.line_id).eq("organization_id", ctx.orgId).maybeSingle();
  if (!line || !line.category) return { ok: false, error: "invalid" };
  const spec = CATEGORY_SPEC[line.category];
  // Pack size: entered for paint (18 L, 4 L…); for bars/boards/boxes it is the product's own size.
  const size = spec.kind === "coverage" ? v.pack_size : spec.kind === "bar" ? line.length_m : spec.kind === "board" ? line.area_m2 : spec.kind === "contents" ? line.contents_per_pack : 1;
  if (!size) return { ok: false, error: "invalid", fieldErrors: { pack_size: "required" } };

  let brandId = v.brand_id;
  if (v.new_brand) {
    const fam = familyOf(line.category);
    const { data: b } = await ctx.supabase.from("brands").select("id, families").eq("organization_id", ctx.orgId).eq("name", v.new_brand).maybeSingle();
    if (b) {
      if (!b.families.includes(fam)) await ctx.supabase.from("brands").update({ families: [...b.families, fam] }).eq("id", b.id);
      brandId = b.id;
    } else {
      const { data: nb, error } = await ctx.supabase.from("brands").insert({ organization_id: ctx.orgId, name: v.new_brand, families: [fam] }).select("id").single();
      if (error) return dbError(error)!;
      brandId = nb.id;
    }
  }

  const { data: product, error } = await ctx.supabase
    .from("products")
    .insert({
      organization_id: ctx.orgId,
      equivalence_group_id: line.id,
      brand_id: brandId,
      name: line.name,
      category: line.category,
      purchase_unit: line.purchase_unit ?? spec.unit,
      colour_specific: line.colour_specific,
      coverage_per_unit: spec.kind === "coverage" ? v.coverage_per_unit : null,
      length_m: line.length_m,
      contents_per_pack: line.contents_per_pack,
      area_m2: line.area_m2,
    })
    .select("id")
    .single();
  if (error) return dbError(error)!;
  const { data: pack, error: e2 } = await ctx.supabase
    .from("product_packs")
    .insert({ organization_id: ctx.orgId, product_id: product.id, size, label: v.pack_label ?? null })
    .select("id")
    .single();
  if (e2) return dbError(e2)!;
  if (v.unit_price != null) {
    const session = await getSession();
    if (can(session, "costs.view")) {
      const { error: e3 } = await ctx.supabase
        .from("product_prices")
        .insert({ organization_id: ctx.orgId, product_id: product.id, pack_id: pack.id, supplier_id: v.supplier_id, unit_price: v.unit_price });
      if (e3) return dbError(e3)!;
    }
  }
  return done();
}

const brandEditSchema = z
  .object({ id, coverage_per_unit: optionalNum({ min: 0.0001, max: 100000 }).optional(), is_active: z.boolean().optional(), line_id: id.optional() })
  .strict();

/** Brand under a product: own coverage (or the product's), hide it, or attach it to a product. */
export async function updateBrandRow(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = brandEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { id: productId, line_id, ...rest } = parsed.data;
  const patch: Partial<ProductRow> = { ...rest };
  if (line_id) {
    const { data: line } = await ctx.supabase.from("equivalence_groups").select("id, category, name").eq("id", line_id).eq("organization_id", ctx.orgId).maybeSingle();
    if (!line) return { ok: false, error: "invalid" };
    patch.equivalence_group_id = line.id;
    if (line.category) patch.category = line.category;
  }
  const { error } = await ctx.supabase.from("products").update(patch).eq("id", productId).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Packs & prices -------------------------------------------------------------

const packSchema = z
  .object({
    product_id: id,
    size: num({ min: 0.0001, max: 100000 }),
    label: optionalText(40),
    unit_price: optionalNum({ min: 0, max: 10_000_000 }),
    supplier_id: optionalId,
  })
  .strict();

export async function addProductPack(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = packSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { unit_price, supplier_id, ...pack } = parsed.data;
  const { data: row, error } = await ctx.supabase.from("product_packs").insert({ ...pack, organization_id: ctx.orgId }).select("id").single();
  if (error) return dbError(error)!;
  if (unit_price != null) {
    const session = await getSession();
    if (!can(session, "costs.view")) return { ok: false, error: "noAccess" };
    const { error: e2 } = await ctx.supabase
      .from("product_prices")
      .insert({ organization_id: ctx.orgId, product_id: pack.product_id, pack_id: row.id, supplier_id, unit_price });
    if (e2) return dbError(e2)!;
  }
  return done();
}

export async function deleteProductPack(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = z.object({ id }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase.from("product_packs").delete().eq("id", parsed.data.id).eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

const priceSchema = z
  .object({
    product_id: id,
    pack_id: id,
    unit_price: num({ min: 0, max: 10_000_000 }),
    supplier_id: optionalId,
    source: optionalText(160),
  })
  .strict();

export async function addProductPrice(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = priceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const { error } = await ctx.supabase.from("product_prices").insert({ ...parsed.data, organization_id: ctx.orgId });
  return dbError(error) ?? done();
}

// --- Consumption rates (engine parameters) ----------------------------------------

const rateSchema = z.object({ id, value: num({ min: 0, max: 1_000_000 }) }).strict();

export async function saveRate(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage", "costs.view");
  if (!isCtx(ctx)) return ctx;
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const today = new Date().toISOString().slice(0, 10);
  const { error } = await ctx.supabase
    .from("consumption_rates")
    .update({ value: parsed.data.value, last_reviewed_at: today })
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

// --- Systems ----------------------------------------------------------------------

const inclusionSchema = z.object({ id, inclusion: z.enum(["always", "on", "off"]) }).strict();

/** Always priced, or optional (included / excluded by default) for each quote. */
export async function saveComponentInclusion(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = inclusionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { error } = await ctx.supabase
    .from("system_components")
    .update({ inclusion: parsed.data.inclusion })
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

const variantsSchema = z
  .object({ id, variant_codes: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/)).min(1).max(10).nullable() })
  .strict();

/** Which variants (roller / profile / spray…) a component is used with; null = all. */
export async function saveComponentVariants(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = variantsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { data: comp } = await ctx.supabase
    .from("system_components")
    .select("system_id")
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!comp) return { ok: false, error: "invalid" };
  if (parsed.data.variant_codes) {
    const { data: variants } = await ctx.supabase.from("system_variants").select("code").eq("system_id", comp.system_id);
    const known = new Set((variants ?? []).map((v) => v.code));
    if (!parsed.data.variant_codes.every((c) => known.has(c))) return { ok: false, error: "invalid" };
  }
  const { error } = await ctx.supabase
    .from("system_components")
    .update({ variant_codes: parsed.data.variant_codes })
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}

const specSchema = z.object({ id, kind: z.enum(["system", "variant"]), spec_text: optionalText(4000) }).strict();

export async function saveSystemSpec(input: unknown): Promise<ActionResult> {
  const ctx = await authorize("catalogue.manage");
  if (!isCtx(ctx)) return ctx;
  const parsed = specSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrors(parsed.error) };
  const table = parsed.data.kind === "system" ? "systems" : "system_variants";
  const { error } = await ctx.supabase
    .from(table)
    .update({ spec_text: parsed.data.spec_text ?? null })
    .eq("id", parsed.data.id)
    .eq("organization_id", ctx.orgId);
  return dbError(error) ?? done();
}
