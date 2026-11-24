import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Bill of quantities: a purchaser with quotes.view but not costs.view gets the quantities of a
 * quote version — and not a single price (quote_version_quantities()); the costs table stays closed.
 */
let owner: string, buyer: string, nobody: string, ownerB: string, org: string, version: string;

const LIST = [
  { key: "ext_finish_لون 1", label: "بروفايل / تكسير — جوتن (لون 1)", brand: "جوتن", colour: "لون 1", packs: [{ size: 18, count: 2 }, { size: 4, count: 1 }], qty: 3, unit: "pack", leftover: 2.5, cost: 405, productId: "p1" },
  { key: "screws", label: "براغي", brand: null, colour: null, packs: [], qty: 7, unit: "box", leftover: null, cost: 245, productId: "p2" },
];
const LINES = [
  { key: "ext_finish_لون 1", group: "material", label: "x", need: 37.5, needUnit: "L", purchase: { kind: "packs", packs: [{ size: 18, count: 2, price: 180 }, { size: 4, count: 1, price: 45 }], volume: 40, leftover: 2.5 }, qty: 3, unit: "pack", unitPrice: 0, cost: 405, formula: "f", inputs: { coveragePerPack: 60 } },
  { key: "screws", group: "material", label: "براغي", need: 6500, needUnit: "pcs", purchase: { kind: "units", count: 7, perPack: 1000 }, qty: 7, unit: "box", unitPrice: 35, cost: 245, formula: "f", inputs: { price: 35 } },
  { key: "hatch_60x60", group: "hatch", label: "فتحة صيانة 60x60", need: 2, needUnit: "pcs", purchase: { kind: "units", count: 2 }, qty: 2, unit: "pcs", unitPrice: 110, cost: 220, formula: "f", inputs: { price: 110 } },
  { key: "labour_walls", group: "labour", label: "مصنعية", need: 100, needUnit: "m2", purchase: { kind: "units", count: 100 }, qty: 100, unit: "m2", unitPrice: 12, cost: 1200, formula: "f", inputs: {} },
];

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500007101");
  buyer = await createUser("966500007102");
  nobody = await createUser("966500007103");
  ownerB = await createUser("966500007104");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await asAdmin((q) =>
    q(
      `insert into public.memberships (organization_id, user_id, role, permission_overrides) values
         ($1,$2,'viewer','{"grant":["quotes.view","purchases.view"],"deny":["costs.view"]}'),
         ($1,$3,'viewer','{"grant":[],"deny":["quotes.view","costs.view"]}')`,
      [org, buyer, nobody],
    ),
  );
  version = await as({ userId: owner }, async (q) => {
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'أبو سعد') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'exterior') returning id", [org, client])).rows[0].id;
    const v = (await asServer<{ id: string }>(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{}',1000,0,0,1000) returning id", [org, quote])).rows[0].id;
    await asServer(q, "insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) values ($1,$2,650,680,30,$3::jsonb,$4::jsonb)", [v, org, JSON.stringify(LINES), JSON.stringify(LIST)]);
    return v;
  });
});
afterAll(closePool);

describe("quote_version_quantities", () => {
  it("gives a quotes.view purchaser the quantities — and no price anywhere", async () => {
    const r = await as({ userId: buyer }, (q) => q<{ r: { items: Record<string, unknown>[]; needs: Record<string, unknown>[] } }>("select public.quote_version_quantities($1) as r", [version]));
    const out = r.rows[0].r;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/cost|price|unitPrice|inputs|405|245|180|220|110|"35"/i);
    expect(out.items).toEqual([
      { key: "ext_finish_لون 1", label: "بروفايل / تكسير — جوتن (لون 1)", brand: "جوتن", colour: "لون 1", packs: [{ size: 18, count: 2 }, { size: 4, count: 1 }], qty: 3, unit: "pack", leftover: 2.5, productId: "p1" },
      { key: "screws", label: "براغي", brand: null, colour: null, packs: [], qty: 7, unit: "box", leftover: null, productId: "p2" },
    ]);
    // labour lines are not bought; hatches are
    expect(out.needs).toEqual([
      { key: "ext_finish_لون 1", need: 37.5, needUnit: "L", perPack: null },
      { key: "screws", need: 6500, needUnit: "pcs", perPack: 1000 },
      { key: "hatch_60x60", need: 2, needUnit: "pcs", perPack: null },
    ]);
  });

  it("the costs themselves stay closed to him", async () => {
    const r = await as({ userId: buyer }, (q) => q("select * from public.quote_version_costs"));
    expect(r.rows).toEqual([]);
  });

  it("refuses without quotes.view, from another organisation, and anonymous callers", async () => {
    await expectDenied(as({ userId: nobody }, (q) => q("select public.quote_version_quantities($1)", [version])), /not allowed/);
    await expectDenied(as({ userId: ownerB }, (q) => q("select public.quote_version_quantities($1)", [version])), /not allowed/);
    await expectDenied(as("anon", (q) => q("select public.quote_version_quantities($1)", [version])), /permission denied/);
  });
});
