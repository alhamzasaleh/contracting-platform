import "server-only";
import { notFound } from "next/navigation";
import { can, type SessionContext } from "@/lib/auth/session";
import type { Line } from "@/lib/engine";
import type { ServiceKind } from "@/lib/pricing";
import { loadProjectHoldings, loadStockItems, projectBoughtRows } from "@/lib/data/purchases";
import type { PurchaseItem } from "@/lib/quotes";
import { materialRows, needsFromLines, type MaterialRow, type QtySource } from "@/lib/quotes/materials";
import { createClient } from "@/lib/supabase/server";

/**
 * Bill of quantities for a quote (its current version) or a project (its contract's agreed
 * version), from the frozen version — never re-priced. Prices only with costs.view, and only
 * when asked: otherwise the quantities come from public.quote_version_quantities(), which
 * returns no price at all. "Bought" (accepted projects, purchases.view): the project's net
 * stock + purchases waiting for approval, the same rule as «من قائمة مشتريات العرض».
 */
export type MaterialsDoc = {
  kind: "quote" | "project";
  number: string;
  quoteNumber: string;
  version: number;
  /** the printed version's option label when the quote offers options («جوتن» / «الجزيرة») */
  option: string | null;
  date: string;
  client: { name: string; phone: string | null; city: string | null };
  service: ServiceKind;
  rows: MaterialRow[];
  prices: boolean;
  /** rows carry bought / remaining */
  bought: boolean;
  /** the viewer may switch to the priced table (costs.view) */
  canPrices: boolean;
  /** «تسجيل مشتريات للمشروع» (accepted project, purchases.manage) */
  canPurchase: boolean;
};

type Supa = Awaited<ReturnType<typeof createClient>>;
type Option = { version: number; label: string };
const optionLabel = (options: unknown, version: number) => (Array.isArray(options) ? ((options as Option[]).find((o) => o.version === version)?.label ?? null) : null);

async function source(supabase: Supa, versionId: string, prices: boolean): Promise<QtySource> {
  if (prices) {
    const { data, error } = await supabase.from("quote_version_costs").select("lines, purchase_list").eq("quote_version_id", versionId).maybeSingle();
    if (error) throw new Error(`quote_version_costs: ${error.code ?? "error"}`);
    if (!data) return { items: [], needs: [] };
    return { items: (data.purchase_list ?? []) as unknown as PurchaseItem[], needs: needsFromLines((data.lines ?? []) as unknown as Line[], { prices: true }) };
  }
  const { data, error } = await supabase.rpc("quote_version_quantities", { p_version: versionId });
  // never "nothing to buy" because the database refused: the page shows the error instead
  if (error) throw new Error(`quote_version_quantities: ${error.code ?? "error"}`);
  const d = (data ?? {}) as unknown as Partial<QtySource>;
  return { items: d.items ?? [], needs: d.needs ?? [] };
}

export async function loadQuoteMaterials(session: SessionContext, number: string, wantPrices: boolean): Promise<MaterialsDoc> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const prices = wantPrices && can(session, "costs.view");
  const { data: q } = await supabase.from("quotes").select("id, number, service, client_id, current_version, options").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!q) notFound();
  const [{ data: client }, { data: v }] = await Promise.all([
    supabase.from("clients").select("name, phone, city").eq("id", q.client_id).maybeSingle(),
    supabase.from("quote_versions").select("id, version, created_at").eq("quote_id", q.id).eq("version", q.current_version).maybeSingle(),
  ]);
  if (!v) notFound();
  const src = await source(supabase, v.id, prices);
  return {
    kind: "quote", number: q.number, quoteNumber: q.number, version: v.version, option: optionLabel(q.options, v.version), date: v.created_at,
    client: client ?? { name: "—", phone: null, city: null }, service: q.service,
    rows: materialRows(src, { prices }), prices, bought: false, canPrices: can(session, "costs.view"), canPurchase: false,
  };
}

export async function loadProjectMaterials(session: SessionContext, number: string, wantPrices: boolean): Promise<MaterialsDoc> {
  const supabase = await createClient();
  const orgId = session.organization.id;
  const prices = wantPrices && can(session, "costs.view");
  // RLS (incl. per-project access) decides whether the contract is visible at all
  const { data: c } = await supabase.from("contracts").select("id, number, status, service, quote_id, quote_version, client_id, options").eq("organization_id", orgId).eq("number", number).maybeSingle();
  if (!c) notFound();
  // bought / still to buy: accepted projects, purchases.view — the purchase form's own loaders
  const withBought = c.status === "accepted" && can(session, "purchases.view");
  const [{ data: client }, { data: quote }, { data: v }, held, items] = await Promise.all([
    supabase.from("clients").select("name, phone, city").eq("id", c.client_id).maybeSingle(),
    supabase.from("quotes").select("number").eq("id", c.quote_id).maybeSingle(),
    supabase.from("quote_versions").select("id, version, created_at").eq("quote_id", c.quote_id).eq("version", c.quote_version).maybeSingle(),
    withBought ? loadProjectHoldings(supabase, orgId, [c.id]) : Promise.resolve(null),
    withBought ? loadStockItems(supabase, orgId) : Promise.resolve([]),
  ]);
  if (!v) notFound();
  const src = await source(supabase, v.id, prices);
  const bought = held ? { stock: items, rows: projectBoughtRows(held, c.id, items) } : undefined;
  return {
    kind: "project", number: c.number, quoteNumber: quote?.number ?? "", version: v.version, option: optionLabel(c.options, v.version), date: v.created_at,
    client: client ?? { name: "—", phone: null, city: null }, service: c.service as ServiceKind,
    rows: materialRows(src, { prices, bought }), prices, bought: withBought, canPrices: can(session, "costs.view"),
    canPurchase: c.status === "accepted" && can(session, "purchases.manage"),
  };
}
