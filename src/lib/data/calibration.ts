import "server-only";
import { can, type SessionContext } from "@/lib/auth/session";
import { calibrate, suggestedCoverage, type CalibrationRow } from "@/lib/calibration";
import { CATEGORY_SPEC } from "@/lib/catalogue/product-kinds";
import type { Line } from "@/lib/engine";
import { rows } from "@/lib/data/query";
import { createClient } from "@/lib/supabase/server";

export type CalibrationView = CalibrationRow & {
  /** the product line (entered once) whose coverage would change, when the quantity is driven by coverage */
  group: { id: string; name: string; coverage: number; suggested: number | null } | null;
};
export type CalibrationData = { rows: CalibrationView[]; projects: number; canApply: boolean };

/** Handed-over projects: planned material (quote, costs.view) vs actually charged (stock movements at cost). */
export async function loadCalibration(session: SessionContext): Promise<CalibrationData> {
  const empty = { rows: [], projects: 0, canApply: false };
  if (!can(session, "costs.view")) return empty;
  const supabase = await createClient();
  const orgId = session.organization.id;
  // the organization's product lines (a few dozen rows) load alongside the projects
  const groupsP = rows(supabase.from("equivalence_groups").select("id, name, category, coverage_per_unit").eq("organization_id", orgId));
  groupsP.catch(() => {}); // awaited below (or not needed when there is nothing to compare)
  const { data: finals } = await supabase.from("project_stages").select("contract_id").eq("organization_id", orgId).eq("is_final", true).eq("status", "confirmed");
  const ids = [...new Set((finals ?? []).map((f) => f.contract_id))];
  if (!ids.length) return { ...empty, canApply: can(session, "catalogue.manage") };
  const contractsP = rows(supabase.from("contracts").select("id, number, quote_id, quote_version").in("id", ids));
  const movesP = rows(supabase.from("inventory_movements").select("contract_id, item_id, quantity, unit_cost").in("contract_id", ids).limit(20000));
  const [contracts, moves, items, { versions, costs }] = await Promise.all([
    contractsP,
    movesP,
    movesP.then((ms) => {
      const itemIds = [...new Set(ms.map((m) => m.item_id))];
      return itemIds.length ? rows(supabase.from("inventory_items").select("id, product_id").in("id", itemIds)) : [];
    }),
    contractsP.then(async (cs) => {
      const versions = await rows(supabase.from("quote_versions").select("id, quote_id, version").in("quote_id", cs.map((c) => c.quote_id)));
      const vids = cs.map((c) => versions.find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.id).filter((x): x is string => !!x);
      return { versions, costs: await rows(supabase.from("quote_version_costs").select("quote_version_id, lines").in("quote_version_id", vids)) };
    }),
  ]);
  const product = new Map((items ?? []).map((i) => [i.id, i.product_id]));
  const vid = (c: { quote_id: string; quote_version: number }) => (versions ?? []).find((v) => v.quote_id === c.quote_id && v.version === c.quote_version)?.id;
  const linesOf = new Map((costs ?? []).map((c) => [c.quote_version_id, c.lines as unknown as Line[]]));

  const input = (contracts ?? []).map((c) => {
    const actual: Record<string, number> = {};
    for (const m of (moves ?? []).filter((x) => x.contract_id === c.id)) {
      const p = product.get(m.item_id);
      if (p) actual[p] = (actual[p] ?? 0) + Number(m.quantity) * Number(m.unit_cost);
    }
    const planned = (linesOf.get(vid(c) ?? "") ?? [])
      .filter((l) => l.group === "material" && l.productId)
      .map((l) => ({ productId: l.productId!, label: l.label, qty: Number(l.qty), unitPrice: Number(l.unitPrice) }));
    return { contract: c.number, planned, actual };
  });
  const result = calibrate(input);

  // products → their product line (coverage entered once per line)
  const pids = result.map((r) => r.productId);
  const [prods, allGroups] = await Promise.all([
    pids.length ? rows(supabase.from("products").select("id, equivalence_group_id").in("id", pids)) : Promise.resolve([] as { id: string; equivalence_group_id: string | null }[]),
    groupsP,
  ]);
  const gids = new Set(prods.map((p) => p.equivalence_group_id).filter((x): x is string => !!x));
  const groups = allGroups.filter((g) => gids.has(g.id));
  return {
    projects: input.length,
    canApply: can(session, "catalogue.manage"),
    rows: result.map((r) => {
      const gid = (prods ?? []).find((p) => p.id === r.productId)?.equivalence_group_id;
      const g = (groups ?? []).find((x) => x.id === gid);
      const coverage = g?.coverage_per_unit ? Number(g.coverage_per_unit) : null;
      const isCoverage = !!g?.category && CATEGORY_SPEC[g.category].kind === "coverage";
      return {
        ...r,
        group: g && coverage && isCoverage ? { id: g.id, name: g.name, coverage, suggested: r.consistent && r.variance != null ? suggestedCoverage(coverage, r.variance) : null } : null,
      };
    }),
  };
}
