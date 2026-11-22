import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, viewer: string, supervisor: string, finance: string;
let org: string, orgB: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000201");
  ownerB = await createUser("966500000202");
  viewer = await createUser("966500000203");
  supervisor = await createUser("966500000204");
  finance = await createUser("966500000205");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, (q) =>
    q(
      `insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer'),($1,$3,'supervisor'),($1,$4,'finance')`,
      [org, viewer, supervisor, finance],
    ),
  );
});
afterAll(closePool);

describe("starter catalogue", () => {
  it("creates pricing settings automatically for new organizations", async () => {
    const r = await as({ userId: owner }, (q) => q("select min_margin_percent, vat_percent from public.pricing_settings"));
    expect(r.rows).toEqual([{ min_margin_percent: "20.00", vat_percent: "15.00" }]);
  });

  it("seeds services, stages and specs once (idempotent)", async () => {
    const first = await as({ userId: owner }, (q) => q<{ n: number }>("select public.seed_starter_catalogue($1) as n", [org]));
    expect(first.rows[0].n).toBe(5);
    const again = await as({ userId: owner }, (q) => q<{ n: number }>("select public.seed_starter_catalogue($1) as n", [org]));
    expect(again.rows[0].n).toBe(0);
    const stages = await as({ userId: owner }, (q) => q("select count(*)::int as n from public.service_stages"));
    expect(stages.rows[0].n).toBeGreaterThan(20);
  });

  it("refuses seeding without catalogue.manage or for another organization", async () => {
    await expectDenied(as({ userId: viewer }, (q) => q("select public.seed_starter_catalogue($1)", [org])), /not allowed/);
    await expectDenied(as({ userId: owner }, (q) => q("select public.seed_starter_catalogue($1)", [orgB])), /not allowed/);
  });
});

describe("materials and prices", () => {
  let material: string;

  it("lets a manager add a material and price history", async () => {
    material = await as({ userId: owner }, async (q) => {
      const m = await q<{ id: string }>(
        "insert into public.materials (organization_id, name_ar, unit) values ($1, 'لوح جبس 12.5مم', 'sheet') returning id",
        [org],
      );
      await q("insert into public.material_prices (organization_id, material_id, unit_price, effective_from) values ($1,$2,21.5, current_date - 10)", [org, m.rows[0].id]);
      await q("insert into public.material_prices (organization_id, material_id, unit_price) values ($1,$2,23)", [org, m.rows[0].id]);
      return m.rows[0].id;
    });
    const p = await as({ userId: owner }, (q) => q("select unit_price from public.material_current_prices where material_id = $1", [material]));
    expect(p.rows[0].unit_price).toBe("23.0000");
  });

  it("keeps price history append-only", async () => {
    const u = await as({ userId: owner }, (q) => q("update public.material_prices set unit_price = 1").catch((e) => e));
    expect(String(u.message ?? "")).toMatch(/permission denied/);
    const d = await as({ userId: owner }, (q) => q("delete from public.material_prices").catch((e) => e));
    expect(String(d.message ?? "")).toMatch(/permission denied/);
  });

  it("shows the material but hides its price from a viewer without costs.view", async () => {
    await as({ userId: owner }, (q) =>
      q(`update public.memberships set permission_overrides = '{"grant":["catalogue.view"],"deny":[]}' where user_id = $1`, [viewer]),
    );
    const m = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.materials"));
    expect(m.rows[0].n).toBe(1);
    const p = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.material_current_prices"));
    expect(p.rows[0].n).toBe(0);
    const s = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.pricing_settings"));
    expect(s.rows[0].n).toBe(0);
  });

  it("lets a supervisor see prices (costs.view) but a deny override hides them", async () => {
    const before = await as({ userId: supervisor }, (q) => q("select count(*)::int as n from public.material_current_prices"));
    expect(before.rows[0].n).toBe(1);
    await as({ userId: owner }, (q) =>
      q(`update public.memberships set permission_overrides = '{"grant":[],"deny":["costs.view"]}' where user_id = $1`, [supervisor]),
    );
    const after = await as({ userId: supervisor }, (q) => q("select count(*)::int as n from public.material_current_prices"));
    expect(after.rows[0].n).toBe(0);
  });

  it("never shows another organization's catalogue", async () => {
    const r = await as({ userId: ownerB }, (q) => q("select count(*)::int as n from public.materials"));
    expect(r.rows[0].n).toBe(0);
  });

  it("refuses linking another organization's material or service", async () => {
    const svcA = await asAdmin(async (q) => (await q<{ id: string }>("select id from public.services where organization_id = $1 limit 1", [org])).rows[0].id);
    await expectDenied(
      as({ userId: ownerB }, (q) =>
        q("insert into public.service_stages (organization_id, service_id, name_ar) values ($1, $2, 'مرحلة')", [orgB, svcA]),
      ),
      /another organization/,
    );
    await expectDenied(
      as({ userId: ownerB }, (q) =>
        q("insert into public.material_prices (organization_id, material_id, unit_price) values ($1, $2, 1)", [orgB, material]),
      ),
      /another organization/,
    );
  });

  it("records catalogue changes in the audit log", async () => {
    const r = await asAdmin((q) =>
      q("select count(*)::int as n from public.audit_log where table_name in ('materials','material_prices') and organization_id = $1", [org]),
    );
    expect(r.rows[0].n).toBeGreaterThanOrEqual(3);
  });
});

describe("employees (HR)", () => {
  it("lets the owner seed statutory cost lines with zero amounts", async () => {
    const n = await as({ userId: owner }, (q) => q<{ n: number }>("select public.seed_employee_cost_items($1) as n", [org]));
    expect(n.rows[0].n).toBe(13);
    const sum = await as({ userId: owner }, (q) => q("select sum(value)::int as s from public.employee_cost_items"));
    expect(sum.rows[0].s).toBe(0);
  });

  it("hides employees and salaries from supervisors", async () => {
    await as({ userId: owner }, (q) =>
      q("insert into public.employees (organization_id, full_name, basic_salary) values ($1, 'عامل', 2000)", [org]),
    );
    const sup = await as({ userId: supervisor }, (q) => q("select count(*)::int as n from public.employees"));
    expect(sup.rows[0].n).toBe(0);
    const fin = await as({ userId: finance }, (q) => q("select count(*)::int as n from public.employees"));
    expect(fin.rows[0].n).toBe(1);
  });

  it("lets finance view but not change employees", async () => {
    const r = await as({ userId: finance }, (q) => q("update public.employees set basic_salary = 9999"));
    expect(r.rowCount).toBe(0);
  });

  it("validates Saudi IBAN and ID formats", async () => {
    await expectDenied(
      as({ userId: owner }, (q) =>
        q("insert into public.employees (organization_id, full_name, iban) values ($1, 'x y', 'DE123')", [org]),
      ),
      /check constraint/,
    );
  });
});

describe("suppliers and coverage", () => {
  let supplierA: string, supplierB: string, mat: string;

  it("uses the preferred supplier's price as the current price", async () => {
    await as({ userId: owner }, async (q) => {
      supplierA = (await q<{ id: string }>("insert into public.suppliers (organization_id, name) values ($1,'مؤسسة الدهانات') returning id", [org])).rows[0].id;
      supplierB = (await q<{ id: string }>("insert into public.suppliers (organization_id, name) values ($1,'مورد ثاني') returning id", [org])).rows[0].id;
      mat = (await q<{ id: string }>(
        "insert into public.materials (organization_id, name_ar, unit, brand, coverage_per_unit, preferred_supplier_id) values ($1,'دهان مطفي','gallon','جوتن',35,$2) returning id",
        [org, supplierA],
      )).rows[0].id;
      await q("insert into public.material_prices (organization_id, material_id, unit_price, supplier_id, effective_from) values ($1,$2,80,$3,current_date - 5)", [org, mat, supplierA]);
      await q("insert into public.material_prices (organization_id, material_id, unit_price, supplier_id) values ($1,$2,75,$3)", [org, mat, supplierB]);
    });
    const cur = await as({ userId: owner }, (q) => q("select unit_price from public.material_current_prices where material_id = $1", [mat]));
    expect(cur.rows[0].unit_price).toBe("80.0000");
    const per = await as({ userId: owner }, (q) => q("select count(*)::int as n from public.material_supplier_prices where material_id = $1", [mat]));
    expect(per.rows[0].n).toBe(2);
  });

  it("accepts coverage-mode recipe lines without a fixed quantity", async () => {
    const svc = await asAdmin(async (q) => (await q<{ id: string }>("select id from public.services where organization_id = $1 and code = 'interior-paint'", [org])).rows[0].id);
    await as({ userId: owner }, (q) =>
      q("insert into public.service_material_recipes (organization_id, service_id, material_id, calc_mode, coats) values ($1,$2,$3,'coverage',2)", [org, svc, mat]),
    );
    const board = await asAdmin(async (q) => (await q<{ id: string }>("select id from public.materials where organization_id = $1 and unit = 'sheet' limit 1", [org])).rows[0].id);
    await expectDenied(
      as({ userId: owner }, (q) =>
        q("insert into public.service_material_recipes (organization_id, service_id, material_id, calc_mode) values ($1,$2,$3,'fixed')", [org, svc, board]),
      ),
      /recipes_qty_required_for_fixed/,
    );
  });

  it("refuses another organization's supplier", async () => {
    const otherSupplier = await as({ userId: ownerB }, async (q) =>
      (await q<{ id: string }>("insert into public.suppliers (organization_id, name) values ($1,'مورد ب') returning id", [orgB])).rows[0].id,
    );
    await expectDenied(
      as({ userId: owner }, (q) => q("update public.materials set preferred_supplier_id = $1 where id = $2", [otherSupplier, mat])),
      /another organization/,
    );
    const r = await as({ userId: owner }, (q) => q("select count(*)::int as n from public.suppliers"));
    expect(r.rows[0].n).toBe(2);
  });
});
