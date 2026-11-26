import "server-only";
import { notFound } from "next/navigation";
import { aiConfigured } from "@/lib/ai/invoice";
import { can, type SessionContext } from "@/lib/auth/session";
import type { Line } from "@/lib/engine";
import { linesFromPurchaseList, markBought, projectBought, projectCostRows, purchaseCharge, stockBalances, type ListLine, type PurchaseCharge } from "@/lib/purchases";
import type { PurchaseItem } from "@/lib/quotes";
import type { PurchaseStatus } from "@/lib/supabase/database.types";
import { rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";

const n = (v: unknown) => Number(v ?? 0);

export type ProjectRef = { id: string; number: string; client: string; status: string; service?: string };
export type PurchaseListItem = {
  id: string; number: string; status: PurchaseStatus; supplier: string | null; invoice_number: string | null; invoice_date: string | null;
  project: ProjectRef | null; total: number; created_at: string;
  /** what it is charged to, as this viewer may see and open it (never "general stock" for a project purchase) */
  charge: PurchaseCharge;
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
  /** purchase drafts per project (contract id → PO numbers): not subtracted from what's left, so the form warns */
  drafts?: Record<string, string[]>;
};
export type QuoteListLine = ListLine & { bought: number; remaining: number };

async function projectsMap(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, canSee: boolean) {
  if (!canSee) return new Map<string, ProjectRef>();
  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase.from("contracts").select("id, number, client_id, status, service").eq("organization_id", orgId).order("created_at", { ascending: false }),
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
  ]);
  const names = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return new Map((contracts ?? []).map((c) => [c.id, { id: c.id, number: c.number, client: names.get(c.client_id) ?? "—", status: c.status, service: c.service }]));
}

/** Which project pages the viewer may open: the contract (quotes.view), else the project (projects.view). */
const projectLinks = (session: SessionContext) => ({ contracts: can(session, "quotes.view"), projects: can(session, "projects.view") });

export async function loadPurchases(session: SessionContext): Promise<PurchaseListItem[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const links = projectLinks(session);
  const [{ data }, projects] = await Promise.all([
    supabase.from("purchases").select("id, number, status, supplier_name, invoice_number, invoice_date, contract_id, total, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(500),
    projectsMap(supabase, orgId, links.contracts || links.projects),
  ]);
  return (data ?? []).map((p) => ({
    ...p, supplier: p.supplier_name, total: n(p.total),
    project: p.contract_id ? (projects.get(p.contract_id) ?? { id: p.contract_id, number: "—", client: "—", status: "" }) : null,
    charge: purchaseCharge(p.contract_id, projects, links),
  }));
}

async function detail(session: SessionContext, number: string): Promise<PurchaseDetail> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const { data: p } = await supabase.from("purchases").select("*").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!p) notFound();
  const links = projectLinks(session);
  const [{ data: lines }, { data: approval }, projects, signed] = await Promise.all([
    supabase.from("purchase_lines").select("seq, kind, item_id, description, colour, quantity, unit, unit_price, amount").eq("purchase_id", p.id).order("seq"),
    supabase.from("approvals").select("id, status, details").eq("entity", "purchase").eq("entity_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    projectsMap(supabase, orgId, links.contracts || links.projects),
    p.attachment_path ? supabase.storage.from("purchase-docs").createSignedUrl(p.attachment_path, 300) : Promise.resolve({ data: null }),
  ]);
  return {
    id: p.id, number: p.number, status: p.status, supplier: p.supplier_name, supplier_id: p.supplier_id, supplier_vat: p.supplier_vat,
    invoice_number: p.invoice_number, invoice_date: p.invoice_date, created_at: p.created_at, notes: p.notes,
    project: p.contract_id ? (projects.get(p.contract_id) ?? null) : null,
    charge: purchaseCharge(p.contract_id, projects, links),
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

type Supa = Awaited<ReturnType<typeof createClient>>;

/** Stock items as every "bought" comparison sees them (same order everywhere: the first match wins). */
export async function loadStockItems(supabase: Supa, orgId: string): Promise<(ItemRef & { product_id: string | null })[]> {
  const items = await rows(supabase.from("inventory_items").select("id, name, unit, is_general, product_id").eq("organization_id", orgId).order("name").order("id"));
  return items.map((i) => ({ ...i, product_id: i.product_id ?? null }));
}

type HeldMove = { item_id: string; contract_id: string | null; quantity: number; purchase_lines: { colour: string | null } | { colour: string | null }[] | null };
type HeldPending = { item_id: string | null; colour: string | null; unit: string; quantity: number; purchases: { contract_id: string | null } | { contract_id: string | null }[] };
export type ProjectHoldings = { moves: HeldMove[]; pending: HeldPending[] };

/** What the projects hold: their stock movements and the material lines of purchases waiting for approval. */
export async function loadProjectHoldings(supabase: Supa, orgId: string, projectIds: string[]): Promise<ProjectHoldings> {
  if (!projectIds.length) return { moves: [], pending: [] };
  const [moves, pending] = await Promise.all([
    rows(supabase.from("inventory_movements").select("item_id, contract_id, quantity, purchase_lines(colour)").eq("organization_id", orgId).in("contract_id", projectIds).limit(20000)),
    rows(supabase.from("purchase_lines").select("item_id, colour, unit, quantity, purchases!inner(contract_id, status)").eq("organization_id", orgId).eq("kind", "material").in("purchases.contract_id", projectIds).eq("purchases.status", "pending_approval").limit(20000)),
  ]);
  return { moves: moves as unknown as HeldMove[], pending: pending as unknown as HeldPending[] };
}

/** One project's "already bought" rows (projectBought) — the purchase form and the bill of quantities share it. */
export function projectBoughtRows(held: ProjectHoldings, contractId: string, items: { id: string; unit: string; product_id: string | null }[]) {
  const first = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));
  const moves = held.moves
    .filter((m) => m.contract_id === contractId)
    // a movement from a purchase line carries its colour; issues / returns / transfers carry none (null)
    .map((m) => { const pl = first(m.purchase_lines); return { item_id: m.item_id, quantity: n(m.quantity), colour: pl ? (pl.colour ?? "") : null }; });
  const pending = held.pending
    .filter((b) => first(b.purchases)?.contract_id === contractId)
    .map((b) => ({ item_id: b.item_id, colour: b.colour, unit: b.unit, quantity: n(b.quantity) }));
  return projectBought(moves, pending, items);
}

export async function loadPurchaseForm(session: SessionContext, number?: string, projectNumber?: string): Promise<PurchaseForm> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  // G2: every accepted project's quote purchase list → suggested lines (costs.view: it carries quoted costs),
  // so picking the project inside the form offers it too; the project from the link comes first.
  // Its queries start together with the rest of the form (chained where one needs another's answer).
  type Con = { id: string; number: string; quote_id: string; quote_version: number };
  const withLists = can(session, "costs.view") && can(session, "quotes.view");
  const listsP = withLists
    ? (async () => {
        const [accepted, one] = await Promise.all([
          rows(supabase.from("contracts").select("id, number, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").order("created_at", { ascending: false }).limit(200)),
          projectNumber
            ? supabase.from("contracts").select("id, number, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").eq("number", projectNumber).maybeSingle().then((r) => r.data)
            : Promise.resolve(null),
        ]);
        const cons: Con[] = accepted;
        if (one && !cons.some((c) => c.number === one.number)) cons.push(one);
        const projectIds = cons.map((c) => c.id);
        // "already bought" = what the project holds now (its stock movements: recorded purchases,
        // issues / transfers in, minus returns — the same movements as its cost) + waiting purchases
        const [{ vid, costs }, held] = await Promise.all([
          (async () => {
            const versions = cons.length ? await rows(supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", [...new Set(cons.map((c) => c.quote_id))])) : [];
            const vid = new Map(versions.map((v) => [`${v.quote_id}|${v.version}`, v.id]));
            const ids = cons.map((c) => vid.get(`${c.quote_id}|${c.quote_version}`)).filter(Boolean) as string[];
            const costs = ids.length ? await rows(supabase.from("quote_version_costs").select("quote_version_id, purchase_list").in("quote_version_id", ids)) : [];
            return { vid, costs };
          })(),
          loadProjectHoldings(supabase, orgId, projectIds),
        ]);
        return { cons, vid, costs, held };
      })()
    : Promise.resolve(null);
  // without costs.view: the linked project's list as quantities only (no price), as the bill of quantities shows it
  const qtyListP =
    !withLists && can(session, "quotes.view") && projectNumber
      ? (async () => {
          const c = (await supabase.from("contracts").select("id, quote_id, quote_version").eq("organization_id", orgId).eq("status", "accepted").eq("number", projectNumber).maybeSingle()).data;
          if (!c) return null;
          const v = (await supabase.from("quote_versions").select("id").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle()).data;
          if (!v) return null;
          const [{ data, error }, held] = await Promise.all([supabase.rpc("quote_version_quantities", { p_version: v.id }), loadProjectHoldings(supabase, orgId, [c.id])]);
          if (error) return null;
          const listItems = (((data ?? {}) as { items?: PurchaseItem[] }).items ?? []).map((it) => ({ ...it, cost: 0 }));
          return { id: c.id, listItems, held };
        })()
      : Promise.resolve(null);
  const draftsP = rows(supabase.from("purchases").select("number, contract_id").eq("organization_id", orgId).eq("status", "draft").not("contract_id", "is", null).limit(500));
  const [purchase, { data: suppliers }, items, projects, products, lists, qtyList, draftRows] = await Promise.all([
    number ? detail(session, number) : Promise.resolve(null),
    supabase.from("suppliers").select("id, name, vat_number").eq("organization_id", orgId).eq("is_active", true).order("name"),
    loadStockItems(supabase, orgId),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
    loadProductOptions(session),
    listsP,
    qtyListP,
    draftsP,
  ]);
  const quoteLists: Record<string, QuoteListLine[]> = {};
  if (lists) {
    const { cons, vid, costs, held } = lists;
    const listOf = new Map((costs ?? []).map((c) => [c.quote_version_id, (c.purchase_list ?? []) as unknown as PurchaseItem[]]));
    for (const c of cons) {
      const list = listOf.get(vid.get(`${c.quote_id}|${c.quote_version}`) ?? "") ?? [];
      if (!list.length) continue;
      quoteLists[c.id] = markBought(linesFromPurchaseList(list, items), projectBoughtRows(held, c.id, items));
    }
  }
  if (qtyList?.listItems.length) quoteLists[qtyList.id] = markBought(linesFromPurchaseList(qtyList.listItems, items), projectBoughtRows(qtyList.held, qtyList.id, items));
  const drafts: Record<string, string[]> = {};
  for (const d of draftRows as { number: string; contract_id: string }[]) (drafts[d.contract_id] ??= []).push(d.number);
  return {
    drafts,
    quoteLists,
    products,
    purchase,
    suppliers: suppliers ?? [],
    items,
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
  const [{ data: items }, { data: moves }, projects, products] = await Promise.all([
    supabase.from("inventory_items").select("id, name, unit, is_general, product_id").eq("organization_id", orgId).order("name"),
    supabase.from("inventory_movements").select("item_id, contract_id, quantity, unit_cost").eq("organization_id", orgId).limit(20000),
    projectsMap(supabase, orgId, can(session, "quotes.view")),
    can(session, "purchases.manage") ? loadProductOptions(session) : Promise.resolve([]),
  ]);
  return {
    items: items ?? [],
    projects: [...projects.values()],
    balances: stockBalances((moves ?? []).map((m) => ({ ...m, quantity: n(m.quantity), unit_cost: n(m.unit_cost) }))),
    canManage: can(session, "purchases.manage"),
    products,
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
  /** success partners' rewards paid on this project (a cost once paid) */
  commission?: number;
};

/**
 * §3.10 estimated vs actual per project: quote material cost vs recorded purchases + transfers.
 * `only` = one contract id (the project page): every query is filtered to it in the database —
 * each project's figures are computed on their own, so the result for it is the same.
 */
export async function loadProjectCosts(session: SessionContext, only?: string): Promise<ProjectCost[]> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const seeCosts = can(session, "costs.view");
  // Promise.resolve: a query builder runs again on every .then(); a real promise runs it once and can be shared
  let contractsQ = supabase.from("contracts").select("id, number, client_id, status, quote_id, quote_version").eq("organization_id", orgId).neq("status", "cancelled");
  let movesQ = supabase.from("inventory_movements").select("contract_id, quantity, unit_cost").eq("organization_id", orgId).not("contract_id", "is", null);
  let purchasesQ = supabase.from("purchases").select("id, contract_id, status, total, subtotal").eq("organization_id", orgId).not("contract_id", "is", null);
  let agreementsQ = supabase.from("subcontractor_agreements").select("id, contract_id").eq("organization_id", orgId);
  let pettyQ = supabase.from("petty_cash_entries").select("contract_id, amount").eq("organization_id", orgId).eq("kind", "expense").not("contract_id", "is", null);
  let repairsQ = supabase.from("maintenance_requests").select("contract_id, cost").eq("organization_id", orgId).eq("covered", true).gt("cost", 0);
  // expense lines of recorded project purchases (filtered in the database through the purchase)
  let expenseQ = supabase.from("purchase_lines").select("purchase_id, amount, purchases!inner(contract_id, status)").eq("organization_id", orgId).eq("kind", "expense").eq("purchases.status", "recorded").not("purchases.contract_id", "is", null);
  let rewardsQ = supabase.from("commission_payments").select("contract_id, amount").eq("organization_id", orgId);
  let adCostsQ = supabase.from("addendum_costs").select("contract_id, material_cost, addenda!inner(status)").eq("organization_id", orgId).eq("addenda.status", "accepted");
  if (only) {
    contractsQ = contractsQ.eq("id", only);
    movesQ = movesQ.eq("contract_id", only);
    purchasesQ = purchasesQ.eq("contract_id", only);
    agreementsQ = agreementsQ.eq("contract_id", only);
    pettyQ = pettyQ.eq("contract_id", only);
    repairsQ = repairsQ.eq("contract_id", only);
    expenseQ = expenseQ.eq("purchases.contract_id", only);
    adCostsQ = adCostsQ.eq("contract_id", only);
    rewardsQ = rewardsQ.eq("contract_id", only);
  }
  const contractsP = Promise.resolve(contractsQ.order("created_at", { ascending: false }));
  const agreementsP = Promise.resolve(agreementsQ);
  const [{ data: contracts }, { data: clients }, { data: moves }, { data: purchases }, { data: subWork }, { data: subAgreements }, { data: petty }, { data: repairs }, { data: labourRows }, { data: expenseLines }, estimates, { data: rewards }] = await Promise.all([
    contractsP,
    supabase.from("clients").select("id, name").eq("organization_id", orgId),
    movesQ.limit(20000),
    purchasesQ,
    only
      ? agreementsP.then(async ({ data }) => {
          const ids = (data ?? []).map((g) => g.id);
          return ids.length ? supabase.from("subcontractor_work").select("agreement_id, amount").in("agreement_id", ids).limit(20000) : { data: [] as { agreement_id: string; amount: number }[] };
        })
      : supabase.from("subcontractor_work").select("agreement_id, amount").eq("organization_id", orgId).limit(20000),
    agreementsP,
    pettyQ.limit(20000),
    repairsQ.limit(20000),
    // in-house labour from the schedule (database function: totals only, but built from salaries → hr.view too)
    seeCosts && can(session, "hr.view") ? supabase.rpc("project_labour_costs", { p_org: orgId }) : Promise.resolve({ data: null }),
    expenseQ,
    // estimated material cost from each contract's quote version (costs.view only, enforced by RLS)
    seeCosts
      ? contractsP.then(async ({ data: list }) => {
          if (!list?.length) return new Map<string, number>();
          const [{ data: versions }, { data: adCosts }] = await Promise.all([
            supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", list.map((c) => c.quote_id)),
            // + accepted additional works' estimated materials (addendum_costs, costs.view)
            adCostsQ,
          ]);
          const vid = new Map((versions ?? []).map((v) => [`${v.quote_id}|${v.version}`, v.id]));
          const ids = list.map((c) => vid.get(`${c.quote_id}|${c.quote_version}`)).filter(Boolean) as string[];
          const { data: costs } = ids.length ? await supabase.from("quote_version_costs").select("quote_version_id, lines").in("quote_version_id", ids) : { data: [] };
          const byVersion = new Map((costs ?? []).map((c) => [c.quote_version_id, (c.lines as unknown as Line[]).filter((l) => l.group === "material").reduce((s, l) => s + l.cost, 0)]));
          const extra = new Map<string, number>();
          for (const a of (adCosts ?? []) as { contract_id: string; material_cost: number }[]) extra.set(a.contract_id, (extra.get(a.contract_id) ?? 0) + n(a.material_cost));
          return new Map(list.map((c) => [c.id, (byVersion.get(vid.get(`${c.quote_id}|${c.quote_version}`) ?? "") ?? 0) + (extra.get(c.id) ?? 0)]).filter(([, v]) => (v as number) > 0) as [string, number][]);
        })
      : Promise.resolve(new Map<string, number>()),
    // success partners' rewards paid (RLS: costs.view / finance.view / marketers.manage)
    rewardsQ.limit(20000),
  ]);
  return projectCostRows({
    contracts: contracts ?? [], clients: clients ?? [], moves: moves ?? [], purchases: purchases ?? [], subWork: subWork ?? [], agreements: subAgreements ?? [],
    petty: petty ?? [], repairs: repairs ?? [], labour: labourRows ?? null, expenseLines: expenseLines ?? [], estimates, vatRegistered: !!session.organization.vat_number,
    commissions: rewards ?? [],
  });
}
