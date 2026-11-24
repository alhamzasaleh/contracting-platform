import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { ServiceSummary } from "@/components/catalogue/services-view";
import type { MaterialItem } from "@/components/catalogue/materials-view";
import { can, type SessionContext } from "@/lib/auth/session";
import { materialCostPerUnit, recipeQtyPerUnit } from "@/lib/costing";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => (v == null ? null : Number(v));

/** Cached per request: several loaders on one page ask for it. */
const pricingSettingsOf = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("pricing_settings").select("*").eq("organization_id", orgId).maybeSingle();
  return data;
});

export async function loadPricingSettings(session: SessionContext) {
  return pricingSettingsOf(session.organization.id);
}

async function loadPrices(session: SessionContext) {
  if (!can(session, "costs.view")) return new Map<string, { price: number; since: string }>();
  const supabase = await createClient();
  const { data } = await supabase
    .from("material_current_prices")
    .select("material_id, unit_price, effective_from")
    .eq("organization_id", session.organization.id);
  return new Map((data ?? []).map((p) => [p.material_id, { price: Number(p.unit_price), since: p.effective_from }]));
}

export async function loadServices(session: SessionContext): Promise<ServiceSummary[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: services }, { data: stages }, { data: recipes }, prices, settings, { data: mats }] = await Promise.all([
    supabase.from("services").select("*").eq("organization_id", orgId).order("sort_order").order("created_at"),
    supabase.from("service_stages").select("service_id").eq("organization_id", orgId),
    supabase.from("service_material_recipes").select("service_id, material_id, qty_per_unit, waste_percent, calc_mode, coats").eq("organization_id", orgId),
    loadPrices(session),
    loadPricingSettings(session),
    supabase.from("materials").select("id, coverage_per_unit").eq("organization_id", orgId),
  ]);
  const coverage = new Map((mats ?? []).map((m) => [m.id, n(m.coverage_per_unit)]));
  const seeCosts = can(session, "costs.view");
  const defaultWaste = Number(settings?.default_waste_percent ?? 5);
  return (services ?? []).map((s) => {
    const lines = (recipes ?? []).filter((r) => r.service_id === s.id);
    const waste = n(s.waste_percent) ?? defaultWaste;
    const cost = materialCostPerUnit(
      lines.map((l) => ({
        qty_per_unit: recipeQtyPerUnit({ calc_mode: l.calc_mode, coats: Number(l.coats), qty_per_unit: n(l.qty_per_unit), coverage_per_unit: coverage.get(l.material_id) ?? null }),
        waste_percent: n(l.waste_percent),
        unit_price: prices.get(l.material_id)?.price ?? null,
      })),
      waste,
    );
    return {
      id: s.id,
      code: s.code,
      name_ar: s.name_ar,
      name_en: s.name_en,
      description: s.description,
      unit: s.unit,
      waste_percent: n(s.waste_percent),
      is_active: s.is_active,
      stages: (stages ?? []).filter((x) => x.service_id === s.id).length,
      recipeLines: lines.length,
      costPerUnit: seeCosts ? cost.total : null,
      missingPrices: cost.missingPrices,
    };
  });
}

export async function loadServiceDetail(session: SessionContext, code: string) {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const all = await loadServices(session);
  const service = all.find((s) => s.code === code);
  if (!service) notFound();

  const [{ data: stages }, { data: specs }, { data: recipe }, { data: materials }, prices, settings] = await Promise.all([
    supabase.from("service_stages").select("*").eq("service_id", service.id).order("sort_order").order("created_at"),
    supabase.from("spec_templates").select("*").eq("service_id", service.id).order("sort_order").order("created_at"),
    supabase.from("service_material_recipes").select("*").eq("service_id", service.id).order("created_at"),
    supabase.from("materials").select("id, name_ar, unit, is_active, brand, coverage_per_unit").eq("organization_id", orgId).order("name_ar"),
    loadPrices(session),
    loadPricingSettings(session),
  ]);
  const matById = new Map((materials ?? []).map((m) => [m.id, m]));

  return {
    service,
    defaultWastePercent: Number(settings?.default_waste_percent ?? 5),
    stages: (stages ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      name_ar: s.name_ar,
      productivity_per_day: n(s.productivity_per_day),
      fixed_days: Number(s.fixed_days),
      notes: s.notes,
    })),
    specs: (specs ?? []).map((s) => ({ id: s.id, title: s.title, body: s.body, is_default: s.is_default })),
    recipe: (recipe ?? []).map((r) => ({
      id: r.id,
      material_id: r.material_id,
      material_name: matById.get(r.material_id)?.name_ar ?? "—",
      material_unit: matById.get(r.material_id)?.unit ?? "piece",
      material_brand: matById.get(r.material_id)?.brand ?? null,
      coverage_per_unit: n(matById.get(r.material_id)?.coverage_per_unit),
      calc_mode: r.calc_mode,
      coats: Number(r.coats),
      qty_per_unit: n(r.qty_per_unit),
      waste_percent: n(r.waste_percent),
      unit_price: prices.get(r.material_id)?.price ?? null,
    })),
    materials: (materials ?? [])
      .filter((m) => m.is_active)
      .map((m) => ({ id: m.id, name_ar: m.name_ar, unit: m.unit, brand: m.brand, coverage_per_unit: n(m.coverage_per_unit) })),
  };
}

export async function loadMaterials(session: SessionContext): Promise<MaterialItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const seeCosts = can(session, "costs.view");
  const [{ data: materials }, prices, { data: history }, suppliers, { data: supplierPrices }] = await Promise.all([
    supabase.from("materials").select("*").eq("organization_id", orgId).order("is_active", { ascending: false }).order("category").order("name_ar"),
    loadPrices(session),
    seeCosts
      ? supabase
          .from("material_prices")
          .select("material_id, unit_price, effective_from, source, supplier_id, created_at")
          .eq("organization_id", orgId)
          .order("effective_from", { ascending: false })
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { material_id: string; unit_price: number; effective_from: string; source: string | null; supplier_id: string | null }[] }),
    loadSuppliers(session),
    seeCosts
      ? supabase.from("material_supplier_prices").select("material_id, supplier_id, unit_price, effective_from").eq("organization_id", orgId)
      : Promise.resolve({ data: [] as { material_id: string; supplier_id: string | null; unit_price: number; effective_from: string }[] }),
  ]);
  const supplierName = new Map(suppliers.map((x) => [x.id, x.name]));
  return (materials ?? []).map((m) => ({
    id: m.id,
    name_ar: m.name_ar,
    name_en: m.name_en,
    category: m.category,
    unit: m.unit,
    scope: m.scope,
    sku: m.sku,
    brand: m.brand,
    package_desc: m.package_desc,
    coverage_per_unit: n(m.coverage_per_unit),
    preferred_supplier_id: m.preferred_supplier_id,
    preferred_supplier_name: m.preferred_supplier_id ? (supplierName.get(m.preferred_supplier_id) ?? null) : null,
    is_active: m.is_active,
    supplierPrices: (supplierPrices ?? [])
      .filter((p) => p.material_id === m.id && p.supplier_id)
      .map((p) => ({ supplier_id: p.supplier_id!, supplier_name: supplierName.get(p.supplier_id!) ?? "—", unit_price: Number(p.unit_price), since: p.effective_from }))
      .sort((a, b) => a.unit_price - b.unit_price),
    price: prices.get(m.id)?.price ?? null,
    priceSince: prices.get(m.id)?.since ?? null,
    history: (history ?? [])
      .filter((h) => h.material_id === m.id)
      .map((h) => ({
        unit_price: Number(h.unit_price),
        effective_from: h.effective_from,
        source: h.source,
        supplier_name: h.supplier_id ? (supplierName.get(h.supplier_id) ?? null) : null,
      })),
  }));
}

export async function loadSuppliers(session: SessionContext) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, contact_name, phone, vat_number, city, notes, is_active")
    .eq("organization_id", session.organization.id)
    .order("is_active", { ascending: false })
    .order("name");
  return data ?? [];
}
