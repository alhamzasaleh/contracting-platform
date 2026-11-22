import "server-only";
import type { ProductItem } from "@/components/catalogue/products-view";
import type { RateItem } from "@/components/catalogue/rates-view";
import type { SystemItem } from "@/components/catalogue/systems-view";
import { can, type SessionContext } from "@/lib/auth/session";
import type { CatalogueData } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => (v == null ? null : Number(v));

export async function loadProducts(session: SessionContext) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const seeCosts = can(session, "costs.view");
  const [{ data: products }, { data: packs }, { data: brands }, { data: groups }, { data: suppliers }, { data: prices }] = await Promise.all([
    supabase.from("products").select("*").eq("organization_id", orgId).order("is_active", { ascending: false }).order("name"),
    supabase.from("product_packs").select("id, product_id, size, label").eq("organization_id", orgId).order("size", { ascending: false }),
    supabase.from("brands").select("id, name, is_active, families").eq("organization_id", orgId).order("name"),
    supabase.from("equivalence_groups").select("id, role, name").eq("organization_id", orgId).order("name"),
    supabase.from("suppliers").select("id, name, is_active").eq("organization_id", orgId).order("name"),
    seeCosts
      ? supabase.from("product_current_prices").select("product_id, pack_id, supplier_id, unit_price, effective_from").eq("organization_id", orgId)
      : Promise.resolve({ data: [] as { product_id: string; pack_id: string | null; supplier_id: string | null; unit_price: number; effective_from: string }[] }),
  ]);
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));
  const group = new Map((groups ?? []).map((g) => [g.id, g]));
  const supplierName = new Map((suppliers ?? []).map((s) => [s.id, s.name]));

  const items: ProductItem[] = (products ?? []).map((p) => {
    const g = p.equivalence_group_id ? group.get(p.equivalence_group_id) : undefined;
    return {
      id: p.id,
      name: p.name,
      brand_id: p.brand_id,
      brand: p.brand_id ? (brandName.get(p.brand_id) ?? null) : null,
      group_id: p.equivalence_group_id,
      group_name: g?.name ?? null,
      role: g?.role ?? null,
      category: p.category,
      purchase_unit: p.purchase_unit,
      ref_pack_size: n(p.ref_pack_size),
      coverage_per_pack: n(p.coverage_per_pack),
      surface_factor: Number(p.surface_factor),
      length_m: n(p.length_m),
      contents_per_pack: n(p.contents_per_pack),
      area_m2: n(p.area_m2),
      colour_specific: p.colour_specific,
      application: p.application,
      waste_percent: n(p.waste_percent),
      notes: p.notes,
      is_active: p.is_active,
      packs: (packs ?? [])
        .filter((k) => k.product_id === p.id)
        .map((k) => {
          const list = (prices ?? [])
            .filter((x) => x.pack_id === k.id)
            .map((x) => ({
              supplier_id: x.supplier_id,
              supplier_name: x.supplier_id ? (supplierName.get(x.supplier_id) ?? "—") : null,
              unit_price: Number(x.unit_price),
              since: x.effective_from,
            }))
            .sort((a, b) => a.unit_price - b.unit_price);
          return { id: k.id, size: Number(k.size), label: k.label, prices: list, best: list[0]?.unit_price ?? null };
        }),
    };
  });

  return {
    products: items,
    brands: (brands ?? []).filter((b) => b.is_active).map((b) => ({ id: b.id, name: b.name, families: b.families })),
    groups: (groups ?? []).map((g) => ({ id: g.id, role: g.role, name: g.name })),
    suppliers: (suppliers ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, name: s.name })),
  };
}

export async function loadRates(session: SessionContext): Promise<RateItem[]> {
  if (!can(session, "costs.view")) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("consumption_rates")
    .select("id, key, value, unit, label, section, sort_order, last_reviewed_at, updated_at")
    .eq("organization_id", session.organization.id)
    .order("section")
    .order("sort_order");
  return (data ?? []).map((r) => ({ ...r, value: Number(r.value) }));
}

export async function loadSystems(session: SessionContext): Promise<SystemItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: systems }, { data: variants }, { data: components }, { data: groups }] = await Promise.all([
    supabase.from("systems").select("id, code, kind, name, spec_text, is_active").eq("organization_id", orgId).order("sort_order").order("created_at"),
    supabase.from("system_variants").select("id, system_id, code, name, spec_text, is_default").eq("organization_id", orgId).order("sort_order"),
    supabase.from("system_components").select("id, system_id, role, equivalence_group_id, inclusion, variant_codes").eq("organization_id", orgId).order("sort_order"),
    supabase.from("equivalence_groups").select("id, name").eq("organization_id", orgId),
  ]);
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  return (systems ?? []).map((s) => ({
    ...s,
    variants: (variants ?? []).filter((v) => v.system_id === s.id).map(({ id, code, name, spec_text, is_default }) => ({ id, code, name, spec_text, is_default })),
    components: (components ?? [])
      .filter((c) => c.system_id === s.id)
      .map((c) => ({ id: c.id, role: c.role, group: c.equivalence_group_id ? (groupName.get(c.equivalence_group_id) ?? c.role) : c.role, inclusion: c.inclusion, variants: c.variant_codes })),
  }));
}

/** Everything the pricing engine needs (requires costs.view). */
export async function loadEngineData(session: SessionContext): Promise<CatalogueData> {
  const [{ products }, rates, systems] = await Promise.all([loadProducts(session), loadRates(session), loadSystems(session)]);
  const rules = systems
    .flatMap((s) => s.components.map((c) => ({ kind: s.kind, role: c.role, inclusion: c.inclusion, variants: c.variants })));
  return {
    products: products
      .filter((p) => p.is_active)
      .map((p) => ({
        id: p.id,
        role: p.role,
        brand: p.brand,
        name: p.name,
        category: p.category,
        unit: p.purchase_unit,
        refPackSize: p.ref_pack_size,
        coveragePerPack: p.coverage_per_pack,
        surfaceFactor: p.surface_factor,
        lengthM: p.length_m,
        contentsPerPack: p.contents_per_pack,
        areaM2: p.area_m2,
        colourSpecific: p.colour_specific,
        wastePercent: p.waste_percent,
        packs: p.packs.map((k) => ({ size: k.size, price: k.best })),
      })),
    rates: Object.fromEntries(rates.map((r) => [r.key, r.value])),
    rules,
  };
}
