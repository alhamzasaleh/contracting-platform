import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, viewer: string;
let org: string, orgB: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000301");
  ownerB = await createUser("966500000302");
  viewer = await createUser("966500000303");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, (q) =>
    q(`insert into public.memberships (organization_id, user_id, role, permission_overrides)
       values ($1,$2,'viewer','{"grant":["catalogue.view"],"deny":[]}')`, [org, viewer]),
  );
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("insert into public.materials (organization_id, name_ar, unit, brand) values ($1, 'دهان قديم مُدخل سابقاً', 'liter', 'Jotun')", [org]);
  });
});
afterAll(closePool);

describe("pricing engine seed (Appendix A.6)", () => {
  it("seeds brands, products with packs and prices, systems and rates — once", async () => {
    const first = await as({ userId: owner }, (q) => q<{ r: { products: number; rates: number } }>("select public.seed_pricing_engine($1) as r", [org]));
    expect(first.rows[0].r.products).toBe(40);
    expect(first.rows[0].r.rates).toBeGreaterThan(50);
    const again = await as({ userId: owner }, (q) => q<{ r: { products: number; rates: number } }>("select public.seed_pricing_engine($1) as r", [org]));
    expect(again.rows[0].r).toEqual({ products: 0, rates: 0 });

    const counts = await as({ userId: owner }, (q) =>
      q(`select (select count(*)::int from public.systems) as systems,
                (select count(*)::int from public.system_variants) as variants,
                (select count(*)::int from public.system_components where equivalence_group_id is null) as orphan_components,
                (select count(*)::int from public.brands) as brands`),
    );
    expect(counts.rows[0]).toEqual({ systems: 4, variants: 11, orphan_components: 0, brands: 8 });
  });

  it("keeps paint brands and gypsum brands apart", async () => {
    const r = await as({ userId: owner }, (q) =>
      q("select name, families from public.brands where name in ('جوتن Jotun', 'مدى Mada', 'كناوف Knauf') order by name"),
    );
    expect(r.rows).toEqual([
      { name: "جوتن Jotun", families: ["paint"] },
      { name: "كناوف Knauf", families: ["gypsum"] },
      { name: "مدى Mada", families: ["gypsum"] },
    ]);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.brands (organization_id, name, families) values ($1, 'x', '{}')", [org])));
  });

  it("stores A.6 values: board 22 SAR, wall finish 18 L covers 120 m², C spacing 1 m", async () => {
    const r = await as({ userId: owner }, (q) =>
      q(`select g.role, p.coverage_per_pack, p.area_m2, cp.unit_price
         from public.products p join public.equivalence_groups g on g.id = p.equivalence_group_id
         join public.product_current_prices cp on cp.product_id = p.id
         where g.role in ('board_normal','wall_finish') order by g.role`),
    );
    expect(r.rows).toEqual([
      { role: "board_normal", coverage_per_pack: null, area_m2: "2.8800", unit_price: "22.0000" },
      { role: "wall_finish", coverage_per_pack: "120.0000", area_m2: null, unit_price: "180.0000" },
    ]);
    const rate = await as({ userId: owner }, (q) => q("select value from public.consumption_rates where key = 'gypsum.cSpacing'"));
    expect(rate.rows[0].value).toBe("1.0000");
  });

  it("carries over materials entered before the engine, linked to their brand", async () => {
    const r = await as({ userId: owner }, (q) =>
      q(`select p.purchase_unit, b.name as brand from public.products p left join public.brands b on b.id = p.brand_id
         where p.legacy_material_id is not null`),
    );
    expect(r.rows).toEqual([{ purchase_unit: "L", brand: "جوتن Jotun" }]);
  });

  it("sets the scope of work: optional items, sealer off, putty not for profile", async () => {
    const r = await as({ userId: owner }, (q) =>
      q(`select s.code, c.role, c.inclusion, c.variant_codes from public.system_components c join public.systems s on s.id = c.system_id
         where c.role in ('sealer', 'primer', 'ext_putty', 'wall_finish') order by s.code, c.role`),
    );
    expect(r.rows).toEqual([
      { code: "exterior-paint", role: "ext_putty", inclusion: "on", variant_codes: ["roller", "spray"] },
      { code: "exterior-paint", role: "sealer", inclusion: "off", variant_codes: null },
      { code: "interior-paint", role: "primer", inclusion: "on", variant_codes: null },
      { code: "interior-paint", role: "sealer", inclusion: "off", variant_codes: null },
      { code: "interior-paint", role: "wall_finish", inclusion: "always", variant_codes: null },
    ]);
    const sealer = await as({ userId: owner }, (q) => q("select category from public.products where name = 'عازل إسمنتي'"));
    expect(sealer.rows).toEqual([{ category: "sealer" }]);
  });

  it("never lets the finish coats or gypsum parts become optional", async () => {
    await expectDenied(
      as({ userId: owner }, (q) =>
        q("update public.system_components set inclusion = 'on' where role = 'wall_finish'"),
      ),
      /always included/,
    );
    await expectDenied(
      as({ userId: owner }, (q) =>
        q("update public.system_components c set inclusion = 'off' from public.systems s where s.id = c.system_id and s.kind = 'gypsum_ceiling' and c.role = 'c_channel'"),
      ),
      /always included/,
    );
    const ok = await as({ userId: owner }, (q) => q("update public.system_components set inclusion = 'off' where role = 'primer' returning id"));
    expect(ok.rowCount).toBe(1);
  });

  it("keeps the scope helper private", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("select private.apply_scope_defaults($1)", [org])));
  });

  it("refuses seeding for a viewer or another organization", async () => {
    await expectDenied(as({ userId: viewer }, (q) => q("select public.seed_pricing_engine($1)", [org])), /not allowed/);
    await expectDenied(as({ userId: owner }, (q) => q("select public.seed_pricing_engine($1)", [orgB])), /not allowed/);
  });
});

describe("pricing engine security", () => {
  it("lets a catalogue viewer see products but not prices or rates", async () => {
    const r = await as({ userId: viewer }, (q) =>
      q(`select (select count(*)::int from public.products) as products,
                (select count(*)::int from public.product_prices) as prices,
                (select count(*)::int from public.product_current_prices) as current,
                (select count(*)::int from public.consumption_rates) as rates`),
    );
    expect(r.rows[0].products).toBeGreaterThan(0);
    expect(r.rows[0]).toMatchObject({ prices: 0, current: 0, rates: 0 });
  });

  it("stops a viewer from editing products", async () => {
    const r = await as({ userId: viewer }, (q) => q("update public.products set name = 'x' returning id"));
    expect(r.rowCount).toBe(0);
  });

  it("isolates organizations completely", async () => {
    const r = await as({ userId: ownerB }, (q) =>
      q(`select (select count(*)::int from public.products) as products,
                (select count(*)::int from public.systems) as systems,
                (select count(*)::int from public.consumption_rates) as rates`),
    );
    expect(r.rows[0]).toEqual({ products: 0, systems: 0, rates: 0 });
  });

  it("refuses links to another organization's records", async () => {
    const groupA = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select id from public.equivalence_groups limit 1")).rows[0].id);
    await expectDenied(
      as({ userId: ownerB }, (q) =>
        q("insert into public.products (organization_id, name, category, purchase_unit, equivalence_group_id) values ($1, 'x y', 'other', 'piece', $2)", [orgB, groupA]),
      ),
      /another organization/,
    );
  });

  it("keeps price history append-only and audits changes", async () => {
    const u = await as({ userId: owner }, (q) => q("update public.product_prices set unit_price = 1").catch((e) => e));
    expect(String(u.message ?? "")).toMatch(/permission denied/);
    await as({ userId: owner }, (q) => q("update public.consumption_rates set value = 45 where key = 'gypsum.productivity'"));
    const a = await as({ userId: owner }, (q) =>
      q("select count(*)::int as n from public.audit_log where table_name = 'consumption_rates' and action = 'update'"),
    );
    expect(a.rows[0].n).toBe(1);
  });
});
