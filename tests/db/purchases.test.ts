import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, buyer: string, ownerB: string;
let org: string, orgB: string, contractA: string, contractB: string, boards: string, paint: string;
const year = new Date().getFullYear();

async function draft(userId: string, opts: { contract?: string | null; lines: { item?: string; kind?: string; qty: number; price: number }[]; vat?: number }) {
  return as({ userId }, async (q) => {
    const sub = opts.lines.reduce((s, l) => s + l.qty * l.price, 0);
    const vat = opts.vat ?? 0;
    const p = (await q<{ id: string; number: string }>(
      "insert into public.purchases (organization_id, supplier_name, contract_id, subtotal, vat, total) values ($1,'مؤسسة التوريد',$2,$3,$4,$5) returning id, number",
      [org, opts.contract ?? null, sub, vat, sub + vat],
    )).rows[0];
    let seq = 1;
    for (const l of opts.lines) {
      await q(
        "insert into public.purchase_lines (organization_id, purchase_id, seq, kind, item_id, description, quantity, unit_price, amount) values ($1,$2,$3,$4,$5,'بند',$6,$7,$8)",
        [org, p.id, seq++, l.kind ?? "material", l.item ?? null, l.qty, l.price, l.qty * l.price],
      );
    }
    return p;
  });
}
const balance = (item: string, contract: string | null) =>
  as({ userId: owner }, async (q) =>
    Number((await q<{ n: string }>("select coalesce(sum(quantity),0) as n from public.inventory_movements where item_id = $1 and contract_id is not distinct from $2", [item, contract])).rows[0].n),
  );

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000901");
  buyer = await createUser("966500000902");
  ownerB = await createUser("966500000903");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, buyer]);
    await q("insert into public.pricing_settings (organization_id, purchase_approval_limit) values ($1, 5000) on conflict (organization_id) do update set purchase_approval_limit = 5000", [org]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    for (const s of ["a", "b"]) {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, quote]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,10,1) returning id", [org, quote, client])).rows[0].id;
      if (s === "a") contractA = c;
      else contractB = c;
    }
    boards = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,'لوح جبس 12.5','board',true) returning id", [org])).rows[0].id;
    paint = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,'دهان لون العميل','pail',false) returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("purchases", () => {
  it("numbers purchases and records a draft into stock movements", async () => {
    const p = await draft(buyer, { contract: contractA, lines: [{ item: boards, qty: 100, price: 22 }, { kind: "expense", qty: 1, price: 150 }] });
    expect(p.number).toBe(`PO-${year}-001`);
    const r = await as({ userId: buyer }, (q) => q<{ s: string }>("select public.submit_purchase($1) as s", [p.id]));
    expect(r.rows[0].s).toBe("recorded");
    expect(await balance(boards, contractA)).toBe(100);
  });

  it("a recorded purchase can't be edited", async () => {
    await expectDenied(as({ userId: buyer }, (q) => q("update public.purchases set total = 1 where number = $1", [`PO-${year}-001`])), /no longer change/);
    await expectDenied(as({ userId: buyer }, (q) => q("update public.purchase_lines set amount = 1")), /can't change/);
  });

  it("staff can't record directly or fake movements", async () => {
    await expectDenied(as({ userId: buyer }, (q) => q("insert into public.purchases (organization_id, status) values ($1,'recorded')", [org])));
    await expectDenied(as({ userId: buyer }, (q) => q("insert into public.inventory_movements (organization_id, item_id, kind, quantity, unit_cost) values ($1,$2,'adjust',5,1)", [org, boards])));
  });

  it("rejects totals that don't add up", async () => {
    const p = await as({ userId: buyer }, async (q) => {
      const x = (await q<{ id: string }>("insert into public.purchases (organization_id, subtotal, vat, total) values ($1,100,0,100) returning id", [org])).rows[0];
      await q("insert into public.purchase_lines (organization_id, purchase_id, seq, kind, description, quantity, unit_price, amount) values ($1,$2,1,'expense','x',1,50,50)", [org, x.id]);
      return x;
    });
    await expectDenied(as({ userId: buyer }, (q) => q("select public.submit_purchase($1)", [p.id])), /add up/);
  });

  it("above the limit it waits for the owner; approval records it", async () => {
    const p = await draft(buyer, { lines: [{ item: boards, qty: 300, price: 20 }] });
    const r = await as({ userId: buyer }, (q) => q<{ s: string }>("select public.submit_purchase($1) as s", [p.id]));
    expect(r.rows[0].s).toBe("pending_approval");
    expect(await balance(boards, null)).toBe(0);
    await expectDenied(as({ userId: buyer }, (q) => q("update public.approvals set status = 'approved' where entity_id = $1 returning id", [p.id]).then((x) => { if (!x.rowCount) throw Object.assign(new Error("denied"), { code: "42501" }); })));
    await as({ userId: owner }, (q) => q("update public.approvals set status = 'approved' where entity_id = $1", [p.id]));
    expect(await balance(boards, null)).toBe(300);
    const s = await as({ userId: owner }, (q) => q<{ status: string }>("select status from public.purchases where id = $1", [p.id]));
    expect(s.rows[0].status).toBe("recorded");
  });

  it("the owner's own large purchase records straight away", async () => {
    const p = await draft(owner, { contract: contractA, lines: [{ item: paint, qty: 10, price: 600 }] });
    const r = await as({ userId: owner }, (q) => q<{ s: string }>("select public.submit_purchase($1) as s", [p.id]));
    expect(r.rows[0].s).toBe("recorded");
  });
});

describe("inventory", () => {
  it("issues from stock to a project and transfers at average cost", async () => {
    await as({ userId: buyer }, (q) => q("select public.move_stock($1, 50, null, $2, 'صرف')", [boards, contractB]));
    expect(await balance(boards, null)).toBe(250);
    expect(await balance(boards, contractB)).toBe(50);
    const cost = await as({ userId: owner }, (q) => q<{ c: string }>("select unit_cost as c from public.inventory_movements where kind = 'issue' and quantity > 0"));
    expect(Number(cost.rows[0].c)).toBe(20);
    await as({ userId: buyer }, (q) => q("select public.move_stock($1, 20, $2, $3)", [boards, contractA, contractB]));
    expect(await balance(boards, contractB)).toBe(70);
  });

  it("can't move more than there is", async () => {
    await expectDenied(as({ userId: buyer }, (q) => q("select public.move_stock($1, 1000, null, $2)", [boards, contractA])), /not enough/);
  });

  it("project-specific material never goes back to general stock", async () => {
    await expectDenied(as({ userId: buyer }, (q) => q("select public.move_stock($1, 1, $2, null)", [paint, contractA])), /stays on its project/);
    await as({ userId: buyer }, (q) => q("select public.move_stock($1, 2, $2, $3)", [paint, contractA, contractB]));
  });

  it("is isolated between organizations", async () => {
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.purchases) + (select count(*)::int from public.inventory_movements) + (select count(*)::int from public.inventory_items) as n"));
    expect(b.rows[0].n).toBe(0);
    await expectDenied(as({ userId: ownerB }, (q) => q("select public.move_stock($1, 1, null, $2)", [boards, contractA])), /not allowed/);
    await expectDenied(as({ userId: ownerB }, (q) => q("select public.submit_purchase(id) from public.purchases")).then(() => { throw Object.assign(new Error("x"), { code: "42501" }); }));
    await expectDenied(
      as({ userId: ownerB }, (q) => q("insert into public.purchases (organization_id, contract_id) values ($1,$2)", [orgB, contractA])),
      /another organization/,
    );
  });
});
