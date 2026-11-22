import { afterAll, beforeAll, expect, it } from "vitest";
import { buildEngineConfig, computeExterior, resolveScope, type CatalogueData } from "@/lib/engine";
import { as, closePool, createUser, resetDatabase } from "./db";

let owner: string, org: string;
beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000401");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Owner Org') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("select public.seed_pricing_engine($1)", [org]);
  });
});
afterAll(closePool);

async function load(): Promise<CatalogueData> {
  return as({ userId: owner }, async (q) => {
    const products = (await q("select p.*, g.role, b.name as brand from public.products p left join public.equivalence_groups g on g.id = p.equivalence_group_id left join public.brands b on b.id = p.brand_id where p.is_active")).rows;
    const packs = (await q("select * from public.product_packs")).rows;
    const prices = (await q("select * from public.product_current_prices")).rows;
    const rates = (await q("select key, value from public.consumption_rates")).rows;
    const comps = (await q("select s.kind, c.role, c.inclusion, c.variant_codes from public.system_components c join public.systems s on s.id = c.system_id")).rows;
    const n = (v: unknown) => (v == null ? null : Number(v));
    return {
      products: products.map((p) => ({
        id: p.id, role: p.role, brand: p.brand, name: p.name, category: p.category, unit: p.purchase_unit,
        refPackSize: n(p.ref_pack_size), coveragePerPack: n(p.coverage_per_pack), surfaceFactor: Number(p.surface_factor),
        lengthM: n(p.length_m), contentsPerPack: n(p.contents_per_pack), areaM2: n(p.area_m2), colourSpecific: p.colour_specific, wastePercent: n(p.waste_percent),
        packs: packs.filter((k) => k.product_id === p.id).map((k) => ({ size: Number(k.size), price: n(prices.filter((x) => x.pack_id === k.id).sort((a, b) => a.unit_price - b.unit_price)[0]?.unit_price) })),
      })),
      rates: Object.fromEntries(rates.map((r) => [r.key, Number(r.value)])),
      rules: comps.map((c) => ({ kind: c.kind, role: c.role, inclusion: c.inclusion, variants: c.variant_codes })),
    };
  });
}

function priceProfile(data: CatalogueData, brand: string) {
  const cfg = buildEngineConfig(data);
  const scope = resolveScope(cfg.rules.exterior, "profile").scope;
  return computeExterior({ area: 660, method: "profile", colours: 1, brand, scope }, cfg.paintProducts, cfg.exterior);
}

it("owner edits the seeded profile: brand Jotun, coverage, price → priced", async () => {
  await as({ userId: owner }, async (q) => {
    const jotun = (await q("select id from public.brands where name like '%Jotun%'")).rows[0].id;
    const p = (await q("select id from public.products where category = 'profile_texture'")).rows[0].id;
    await q("update public.products set brand_id = $1, coverage_per_pack = 40 where id = $2", [jotun, p]);
    const pack = (await q("select id from public.product_packs where product_id = $1", [p])).rows[0].id;
    await q("insert into public.product_prices (organization_id, product_id, pack_id, unit_price) values ($1,$2,$3,300)", [org, p, pack]);
  });
  const r = priceProfile(await load(), "جوتن Jotun");

  expect(r.lines.some((l) => l.key.startsWith("ext_finish") && l.cost > 0)).toBe(true);
});

it("owner adds a NEW Jotun profile product without a line (old form) → linked by the migration and priced", async () => {
  const { readFileSync } = await import("node:fs");
  const { asAdmin } = await import("./db");
  await as({ userId: owner }, async (q) => {
    const jotun = (await q("select id from public.brands where name like '%Jotun%'")).rows[0].id;
    const p = (await q(
      "insert into public.products (organization_id, brand_id, name, category, purchase_unit, ref_pack_size, coverage_per_pack) values ($1,$2,'جوتن بروفايل','profile_texture','L',18,35) returning id",
      [org, jotun],
    )).rows[0].id;
    const pack = (await q("insert into public.product_packs (organization_id, product_id, size) values ($1,$2,18) returning id", [org, p])).rows[0].id;
    await q("insert into public.product_prices (organization_id, product_id, pack_id, unit_price) values ($1,$2,$3,280)", [org, p, pack]);
    // generic one back to incomplete, as on the live site
    await q("update public.products set coverage_per_pack = null, brand_id = null where name = 'بروفايل خارجي'");
  });
  const before = priceProfile(await load(), "جوتن Jotun");
  expect(before.lines.map((l) => l.key)).toContain("missing_profile");

  await asAdmin((q) => q(readFileSync("supabase/migrations/20261130000001_link_orphan_products.sql", "utf8")));
  const after = priceProfile(await load(), "جوتن Jotun");

  expect(after.lines.some((l) => l.key.startsWith("ext_finish") && l.cost > 0)).toBe(true);
});
