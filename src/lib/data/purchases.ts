import "server-only";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import type { Line } from "@/lib/engine";
import { stockBalances } from "@/lib/purchases";
import type { PurchaseStatus } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

export type ProjectRef = { id: string; number: string; client: string; status: string };
export type PurchaseListItem = {
  id: string; number: string; status: PurchaseStatus; supplier: string | null; invoice_number: string | null; invoice_date: string | null;
  project: ProjectRef | null; total: number; created_at: string;
};
export type PurchaseLineView = { seq: number; kind: "material" | "expense"; item_id: string | null; description: string; colour: string | null; quantity: number; unit: string; unit_price: number; amount: number };
export type ItemRef = { id: string; name: string; unit: string; is_general: boolean };
export type PurchaseDetail = PurchaseListItem & {
  supplier_id: string | null; supplier_vat: string | null; subtotal: number; vat: number; notes: string | null; ai_extracted: boolean; ai_flags: Record<string, unknown>;
  lines: PurchaseLineView[]; attachment_path: string | null; attachmentUrl: string | null; attachmentIsPdf: boolean;
  approval: { id: string; status: string; limit: number | null } | null;
  canManage: boolean; canDecide: boolean;
};
export type PurchaseForm = {
  purchase: PurchaseDetail | null;
  suppliers: { id: string; name: string; vat_number: string | null }[];
  items: ItemRef[];
  projects: ProjectRef[];
  aiEnabled: boolean;
  vatRegistered: boolean;
};

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
  };
}

export const loadPurchase = detail;

export async function loadPurchaseForm(session: SessionContext, number?: string): Promise<PurchaseForm> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [purchase, { data: suppliers }, { data: items }, projects] = await Promise.all([
    number ? detail(session, number) : Promise.resolve(null),
    supabase.from("suppliers").select("id, name, vat_number").eq("organization_id", orgId).eq("is_active", true).order("name"),
    supabase.from("inventory_items").select("id, name, unit, is_general").eq("organization_id", orgId).order("name"),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
  ]);
  return {
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
};

export async function loadInventory(session: SessionContext): Promise<InventoryData> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: items }, { data: moves }, projects] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit, is_general").eq("organization_id", orgId).order("name"),
    supabase.from("inventory_movements").select("item_id, contract_id, quantity, unit_cost").eq("organization_id", orgId).limit(20000),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
  ]);
  return {
    items: items ?? [],
    projects: [...projects.values()],
    balances: stockBalances((moves ?? []).map((m) => ({ ...m, quantity: n(m.quantity), unit_cost: n(m.unit_cost) }))),
    canManage: can(session, "purchases.manage"),
  };
}

export type ProjectCost = ProjectRef & { estimated: number | null; materials: number; expenses: number; actual: number; pending: number };

/** §3.10 estimated vs actual per project: quote material cost vs recorded purchases + transfers. */
export async function loadProjectCosts(session: SessionContext): Promise<ProjectCost[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const [{ data: contracts }, { data: clients }, { data: moves }, { data: purchases }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, status, quote_id, quote_version").eq("organization_id", orgId).neq("status", "cancelled").order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
    supabase.from("inventory_movements").select("contract_id, quantity, unit_cost").eq("organization_id", orgId).not("contract_id", "is", null).limit(20000),
    supabase.from("purchases").select("id, contract_id, status, total, subtotal").eq("organization_id", orgId).not("contract_id", "is", null),
  ]);
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
    estimates = new Map(contracts.map((c) => [c.id, byVersion.get(vid.get(`${c.quote_id}|${c.quote_version}`) ?? "") ?? 0]).filter(([, v]) => (v as number) > 0) as [string, number][]);
  }

  return (contracts ?? []).map((c) => {
    const materials = (moves ?? []).filter((m) => m.contract_id === c.id).reduce((s, m) => s + n(m.quantity) * n(m.unit_cost), 0);
    const expenses = (expenseLines ?? []).filter((l) => purchaseContract.get(l.purchase_id) === c.id).reduce((s, l) => s + n(l.amount) * (vatFactor.get(l.purchase_id) ?? 1), 0);
    const pending = (purchases ?? []).filter((p) => p.contract_id === c.id && p.status === "pending_approval").reduce((s, p) => s + n(p.total), 0);
    const r = (x: number) => Math.round(x * 100) / 100;
    return {
      id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", status: c.status,
      estimated: estimates.get(c.id) ?? null, materials: r(materials), expenses: r(expenses), actual: r(materials + expenses), pending: r(pending),
    };
  });
}
