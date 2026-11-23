import "server-only";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import type { Line } from "@/lib/engine";
import { linesFromPurchaseList, markBought, stockBalances, type ListLine } from "@/lib/purchases";
import type { PurchaseItem } from "@/lib/quotes";
import type { PurchaseStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

export type ProjectRef = { id: string; number: string; client: string; status: string };
export type PurchaseListItem = {
  id: string; number: string; status: PurchaseStatus; supplier: string | null; invoice_number: string | null; invoice_date: string | null;
  project: ProjectRef | null; total: number; created_at: string;
};
export type PurchaseLineView = { seq: number; kind: "material" | "expense"; item_id: string | null; description: string; colour: string | null; quantity: number; unit: string; unit_price: number; amount: number };
export type ItemRef = { id: string; name: string; unit: string; is_general: boolean; product_id?: string | null };
export type PurchaseDetail = PurchaseListItem & {
  supplier_id: string | null; supplier_vat: string | null; subtotal: number; vat: number; notes: string | null; ai_extracted: boolean; ai_flags: Record<string, unknown>;
  lines: PurchaseLineView[]; attachment_path: string | null; attachmentUrl: string | null; attachmentIsPdf: boolean;
  approval: { id: string; status: string; limit: number | null } | null;
  canManage: boolean; canDecide: boolean;
  /** the supplier was paid (finance records it; Qoyod gets the bill payment) */
  paid: { on: string; from: "bank" | "cash"; reference: string | null } | null;
  canPay: boolean;
};
export type PurchaseForm = {
  purchase: PurchaseDetail | null;
  suppliers: { id: string; name: string; vat_number: string | null }[];
  items: ItemRef[];
  projects: ProjectRef[];
  aiEnabled: boolean;
  vatRegistered: boolean;
  /** catalogue products a stock item can be linked to (calibration) — catalogue.view */
  products?: { id: string; label: string }[];
  /**
   * Each accepted project's quote purchase list, ready as lines (costs.view), keyed by contract id,
   * with what was already bought for that project (recorded or waiting purchases).
   */
  quoteLists?: Record<string, QuoteListLine[]>;
};
export type QuoteListLine = ListLine & { bought: number; remaining: number };

async function projectsMap(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, canSee: boolean) {
  if (!canSee) return new Map<string, ProjectRef>();
  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, status").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return new Map((contracts ?? []).map((c) => [c.id, { id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", status: c.status }]));
}

export async function loadPurchases(session: SessionContext): Promise<PurchaseListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data }, projects] = await Promise.all([
    supabase.from("purchases").select("id, number, status, supplier_name, invoice_number, invoice_date, contract_id, total, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(500),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
  ]);
  return (data ?? []).map((p) => ({ ...p, supplier: p.supplier_name, total: n(p.total), project: p.contract_id ? (projects.get(p.contract_id) ?? { id: p.contract_id, number: "—", client: "—", status: "" }) : null }));
}

async function detail(session: SessionContext, number: string): Promise<PurchaseDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: p } = await supabase.from("purchases").select("*").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!p) notFound();
  const [{ data: lines }, { data: approval }, projects, signed] = await Promise.all([
    supabase.from("purchase_lines").select("seq, kind, item_id, description, colour, quantity, unit, unit_price, amount").eq("purchase_id", p.id).order("seq"),
    supabase.from("approvals").select("id, status, details").eq("entity", "purchase").eq("entity_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
    p.attachment_path ? supabase.storage.from("purchase-docs").createSignedUrl(p.attachment_path, 300) : Promise.resolve({ data: null }),
  ]);
  return {
    id: p.id, number: p.number, status: p.status, supplier: p.supplier_name, supplier_id: p.supplier_id, supplier_vat: p.supplier_vat,
    invoice_number: p.invoice_number, invoice_date: p.invoice_date, created_at: p.created_at, notes: p.notes,
    project: p.contract_id ? (projects.get(p.contract_id) ?? null) : null,
    subtotal: n(p.subtotal), vat: n(p.vat), total: n(p.total), ai_extracted: p.ai_extracted, ai_flags: (p.ai_flags ?? {}) as Record<string, unknown>,
    lines: (lines ?? []).map((l) => ({ ...l, quantity: n(l.quantity), unit_price: n(l.unit_price), amount: n(l.amount) })),
    attachment_path: p.attachment_path,
    attachmentUrl: signed.data?.signedUrl ?? null,
    attachmentIsPdf: (p.attachment_path ?? "").endsWith(".pdf"),
    approval: approval ? { id: approval.id, status: approval.status, limit: (approval.details as { limit?: number } | null)?.limit ?? null } : null,
    canManage: can(session, "purchases.manage"),
    canDecide: can(session, "approvals.decide"),
    paid: p.paid_on ? { on: p.paid_on, from: (p.paid_from ?? "bank") as "bank" | "cash", reference: p.paid_reference ?? null } : null,
    canPay: can(session, "finance.manage"),
  };
}

export const loadPurchase = detail;

/** Catalogue products as "brand — name" for the stock-item picker (catalogue.view; empty otherwise). */
export async function loadProductOptions(session: SessionContext): Promise<{ id: string; label: string }[]> {
  if (!can(session, "catalogue.view")) return [];
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: products }, { data: brands }] = await Promise.all([
    supabase.from("products").select("id, name, brand_id").eq("organization_id", orgId).eq("is_active", true).order("name").limit(2000),
    supabase.from("brands").select("id, name").eq("organization_id", orgId),
  ]);
  const brand = new Map((brands ?? []).map((b) => [b.id, b.name]));
  return (products ?? [])
    .map((p) => ({ id: p.id, label: p.brand_id && brand.get(p.brand_id) ? `${brand.get(p.brand_id)} — ${p.name}` : p.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
}

export async function loadPurchaseForm(session: SessionContext, number?: string, projectNumber?: string): Promise<PurchaseForm> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [purchase, { data: suppliers }, { data: items }, projects, products] = await Promise.all([
    number ? detail(session, number) : Promise.resolve(null),
    supabase.from("suppliers").select("id, name, vat_number").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase.from("inventory_items").select("id, name, unit, is_general, product_id").eq("organization_id", orgId).order("name"),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
    loadProductOptions(session),
  ]);
  // G2: every accepted project's quote purchase list → suggested lines (costs.view: it carries quoted costs),
  // so picking the project inside the form offers it too; the project from the link comes first
  const quoteLists: Record<string, QuoteListLine[]> = {};
  if (can(session, "costs.view") && can(session, "quotes.view")) {
    const { data: accepted } = await supabase.from("contracts").select("id, number, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").order("created_at", { ascending: false }).limit(200);
    const cons = accepted ?? [];
    if (projectNumber && !cons.some((c) => c.number === projectNumber)) {
      const { data: one } = await supabase.from("contracts").select("id, number, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").eq("number", projectNumber).maybeSingle();
      if (one) cons.push(one);
    }
    const { data: versions } = cons.length ? await supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", [...new Set(cons.map((c) => c.quote_id))]) : { data: [] };
    const vid = new Map((versions ?? []).map((v) => [`${v.quote_id}|${v.version}`, v.id]));
    const ids = cons.map((c) => vid.get(`${c.quote_id}|${c.quote_version}`)).filter(Boolean) as string[];
    const [{ data: costs }, { data: boughtRows }] = await Promise.all([
      ids.length ? supabase.from("quote_version_costs").select("quote_version_id, purchase_list").in("quote_version_id", ids) : Promise.resolve({ data: [] as { quote_version_id: string; purchase_list: unknown }[] }),
      cons.length
        ? supabase.from("purchase_lines").select("item_id, unit, quantity, purchases!inner(contract_id, status)").eq("organization_id", orgId).eq("kind", "material").in("purchases.contract_id", cons.map((c) => c.id)).in("purchases.status", ["recorded", "pending_approval"]).limit(20000)
        : Promise.resolve({ data: [] }),
    ]);
    const listOf = new Map((costs ?? []).map((c) => [c.quote_version_id, (c.purchase_list ?? []) as unknown as PurchaseItem[]]));
    const itemRefs = (items ?? []).map((i) => ({ ...i, product_id: i.product_id ?? null }));
    const productOf = new Map(itemRefs.map((i) => [i.id, i.product_id]));
    type Bought = { item_id: string | null; unit: string; quantity: number; purchases: { contract_id: string | null } | { contract_id: string | null }[] };
    for (const c of cons) {
      const list = listOf.get(vid.get(`${c.quote_id}|${c.quote_version}`) ?? "") ?? [];
      if (!list.length) continue;
      const bought = ((boughtRows ?? []) as unknown as Bought[])
        .filter((b) => (Array.isArray(b.purchases) ? b.purchases[0]?.contract_id : b.purchases?.contract_id) === c.id)
        .map((b) => ({ item_id: b.item_id, product_id: b.item_id ? (productOf.get(b.item_id) ?? null) : null, unit: b.unit, quantity: n(b.quantity) }));
      quoteLists[c.id] = markBought(linesFromPurchaseList(list, itemRefs), bought);
    }
  }
  return {
    quoteLists,
    products,
    purchase,
    suppliers: suppliers ?? [],
    items: items ?? [],
    projects: [...projects.values()].filter((p) => p.status !== "cancelled"),
    aiEnabled: aiConfigured(),
    vatRegistered: Boolean(session.organization.vat_number),
  };
}

export type InventoryData = {
  items: ItemRef[];
  projects: ProjectRef[];
  balances: { item_id: string; contract_id: string | null; quantity: number; value: number }[];
  canManage: boolean;
  /** catalogue products a stock item can be linked to (calibration) */
  products?: { id: string; label: string }[];
};

export async function loadInventory(session: SessionContext): Promise<InventoryData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: items }, { data: moves }, projects] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit, is_general, product_id").eq("organization_id", orgId).order("name"),
    supabase.from("inventory_movements").select("item_id, contract_id, quantity, unit_cost").eq("organization_id", orgId).limit(20000),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
  ]);
  return {
    items: items ?? [],
    projects: [...projects.values()],
    balances: stockBalances((moves ?? []).map((m) => ({ ...m, quantity: n(m.quantity), unit_cost: n(m.unit_cost) }))),
    canManage: can(session, "purchases.manage"),
    products: can(session, "purchases.manage") ? await loadProductOptions(session) : [],
  };
}

export type ProjectCost = ProjectRef & {
  estimated: number | null; materials: number; expenses: number; subcontractors: number; petty: number; pending: number;
  /** materials + expenses + petty cash — what the material estimate is compared with (overrun alerts too) */
  materialsActual: number;
  /** full actual cost: materialsActual + subcontractors earned + in-house labour (when shown) — the same figure as profit uses */
  actual: number;
  /** in-house labour: scheduled work days (up to today) × the team's loaded cost per day — totals only, costs.view + hr.view (null without them) */
  labour?: number | null;
  /** maintenance covered by the warranty (the company pays; repairs charged to the client are not our cost) */
  maintenance?: number;
};

/** §3.10 estimated vs actual per project: quote material cost vs recorded purchases + transfers. */
export async function loadProjectCosts(session: SessionContext): Promise<ProjectCost[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }, { data: moves }, { data: purchases }, { data: subWork }, { data: subAgreements }, { data: petty }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, status, quote_id, quote_version").eq("organization_id", orgId).neq("status", "cancelled").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
    supabase.from("inventory_movements").select("contract_id, quantity, unit_cost").eq("organization_id", orgId).not("contract_id", "is", null).limit(20000),
    supabase.from("purchases").select("id, contract_id, status, total, subtotal").eq("organization_id", orgId).not("contract_id", "is", null),
    supabase.from("subcontractor_work").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
    supabase.from("subcontractor_agreements").select("id, contract_id").eq("organization_id", orgId),
    supabase.from("petty_cash_entries").select("contract_id, amount").eq("organization_id", orgId).eq("kind", "expense").not("contract_id", "is", null).limit(20000),
  ]);
  const { data: repairs } = await supabase.from("maintenance_requests").select("contract_id, cost").eq("organization_id", orgId).eq("covered", true).gt("cost", 0).limit(20000);
  // in-house labour from the schedule (database function: totals only, but built from salaries → hr.view too)
  const { data: labourRows } = can(session, "costs.view") && can(session, "hr.view") ? await supabase.rpc("project_labour_costs", { p_org: orgId }) : { data: null };
  const labourOf = new Map((labourRows ?? []).map((l) => [l.contract_id, n(l.labour)]));
  const agreementContract = new Map((subAgreements ?? []).map((g) => [g.id, g.contract_id]));
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const recordedIds = (purchases ?? []).filter((p) => p.status === "recorded").map((p) => p.id);
  const { data: expenseLines } = recordedIds.length
    ? await supabase.from("purchase_lines").select("purchase_id, amount").eq("kind", "expense").in("purchase_id", recordedIds)
    : { data: [] as { purchase_id: string; amount: number }[] };
  const purchaseContract = new Map((purchases ?? []).map((p) => [p.id, p.contract_id as string]));
  // without a VAT number, VAT is a cost too
  const vatFactor = new Map((purchases ?? []).map((p) => [p.id, session.organization.vat_number || !n(p.subtotal) ? 1 : n(p.total) / n(p.subtotal)]));

  // estimated material cost from each contract's quote version (costs.view only, enforced by RLS)
  let estimates = new Map<string, number>();
  if (can(session, "costs.view") && contracts?.length) {
    const { data: versions } = await supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", contracts.map((c) => c.quote_id));
    const vid = new Map((versions ?? []).map((v) => [`${v.quote_id}|${v.version}`, v.id]));
    const ids = contracts.map((c) => vid.get(`${c.quote_id}|${c.quote_version}`)).filter(Boolean) as string[];
    const { data: costs } = ids.length ? await supabase.from("quote_version_costs").select("quote_version_id, lines").in("quote_version_id", ids) : { data: [] };
    const byVersion = new Map((costs ?? []).map((c) => [c.quote_version_id, (c.lines as unknown as Line[]).filter((l) => l.group === "material").reduce((s, l) => s + l.cost, 0)]));
    // + accepted additional works' estimated materials (addendum_costs, costs.view)
    const { data: adCosts } = await supabase.from("addendum_costs").select("contract_id, material_cost, addenda!inner(status)").eq("organization_id", orgId).eq("addenda.status", "accepted");
    const extra = new Map<string, number>();
    for (const a of (adCosts ?? []) as { contract_id: string; material_cost: number }[]) extra.set(a.contract_id, (extra.get(a.contract_id) ?? 0) + n(a.material_cost));
    estimates = new Map(contracts.map((c) => [c.id, (byVersion.get(vid.get(`${c.quote_id}|${c.quote_version}`) ?? "") ?? 0) + (extra.get(c.id) ?? 0)]).filter(([, v]) => (v as number) > 0) as [string, number][]);
  }

  return (contracts ?? []).map((c) => {
    const materials = (moves ?? []).filter((m) => m.contract_id === c.id).reduce((s, m) => s + n(m.quantity) * n(m.unit_cost), 0);
    const expenses = (expenseLines ?? []).filter((l) => purchaseContract.get(l.purchase_id) === c.id).reduce((s, l) => s + n(l.amount) * (vatFactor.get(l.purchase_id) ?? 1), 0);
    const subs = (subWork ?? []).filter((w) => agreementContract.get(w.agreement_id) === c.id).reduce((s, w) => s + n(w.amount), 0);
    const pettySum = (petty ?? []).filter((e) => e.contract_id === c.id).reduce((s, e) => s + n(e.amount), 0);
    const pending = (purchases ?? []).filter((p) => p.contract_id === c.id && p.status === "pending_approval").reduce((s, p) => s + n(p.total), 0);
    const r = (x: number) => Math.round(x * 100) / 100;
    const labour = labourRows ? labourOf.get(c.id) ?? 0 : null;
    const maintenance = (repairs ?? []).filter((m) => m.contract_id === c.id).reduce((s, m) => s + n(m.cost), 0);
    return {
      id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", status: c.status,
      estimated: estimates.get(c.id) ?? null, materials: r(materials), expenses: r(expenses), subcontractors: r(subs), petty: r(pettySum),
      materialsActual: r(materials + expenses + pettySum),
      actual: r(materials + expenses + pettySum + subs + maintenance + (labour ?? 0)), pending: r(pending),
      labour: labour == null ? null : r(labour), maintenance: r(maintenance),
    };
  });
}
