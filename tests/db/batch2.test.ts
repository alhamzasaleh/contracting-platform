import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Review batch 2 (Nov 2026) — connections & consistent numbers:
 * #9 client-page link lasts until the real warranty end · #12 addenda estimated cost + agreements to review ·
 * #14 money documents follow finance.view · #17 uncovered maintenance in actual cost ·
 * G4 subcontractor payments and petty cash reach Qoyod · Qoyod account settings are writable.
 */
let owner: string, sup: string, fin: string, viewer: string, restricted: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
type Made = { id: string; number: string; quote: string; token: string };

async function makeContract(total: number, opts: { start?: string; days?: number; warranty?: number; materials?: number } = {}): Promise<Made> {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    const v = (await asServer<{ id: string }>(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{\"workTypes\":[{\"workType\":\"ceilings\",\"area\":100}]}',$3,$3) returning id", [org, quote, total])).rows[0].id;
    if (opts.materials != null) {
      await asServer(q, "insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) values ($1,$2,$3,$3,30,$4,'[]')", [v, org, opts.materials, JSON.stringify([{ group: "material", cost: opts.materials }])]);
    }
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>(
      "insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, warranty_months, total, status) values ($1,$2,1,$3,'gypsum',$4,$5,$6,$7,'sent') returning id, number",
      [org, quote, client, opts.start ?? new Date().toISOString().slice(0, 10), opts.days ?? 10, opts.warranty ?? 6, total],
    )).rows[0];
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'دفعة',100,$3,'signing')", [org, c.id, total]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, quote, token };
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}

async function makeAddendum(c: Made, total: number, days = 2): Promise<string> {
  const a = await as({ userId: owner }, async (q) => {
    const row = (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, vat, total, extra_days) values ($1,$2,'أعمال إضافية','بيت إنارة',$3,0,$3,$4) returning id", [org, c.id, total, days])).rows[0];
    await q("select public.submit_addendum($1)", [row.id]);
    await q("update public.addenda set status = 'sent' where id = $1", [row.id]);
    return row.id;
  });
  await as("service_role", (q) => q("select public.portal_accept_addendum($1,$2,$3,'محمد',null,'1.1.1.1','x')", [c.number, c.token, a]));
  return a;
}

const newLink = (user: string, contract: string, expires: string) =>
  as({ userId: user }, (q) =>
    q<{ expires_at: Date }>("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3,$4) returning expires_at", [org, contract, hash(randomBytes(8).toString("hex")), expires]),
  ).then((r) => r.rows[0].expires_at);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500029001");
  sup = await createUser("966500029002");
  fin = await createUser("966500029003");
  viewer = await createUser("966500029004");
  restricted = await createUser("966500029005");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B2') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance'),($1,$4,'viewer'),($1,$5,'supervisor')", [org, sup, fin, viewer, restricted]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name, id_number) values ($1,'966500008888','عميل','1000000008') returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("#9 the client-page link lasts until the real end of the warranty", () => {
  it("a link reissued after a late handover is valid until the warranty ends + 1 day, exactly", async () => {
    // planned long ago: the app's planned expiry would already be over
    const c = await makeContract(5000, { start: "2025-01-01", days: 10, warranty: 6 });
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1 and is_final", [c.id]));
    const end = (await asAdmin((q) => q<{ d: string }>("select (private.warranty_end($1) + 1)::text as d", [c.id]))).rows[0].d;
    const exact = new Date(`${end}T00:00:00+03:00`).getTime();
    // whatever staff ask for (90 days, or longer than the warranty): the warranty end decides
    expect(new Date(await newLink(owner, c.id, new Date(Date.now() + 90 * 86_400_000).toISOString())).getTime()).toBe(exact);
    expect(new Date(await newLink(owner, c.id, new Date(Date.now() + 900 * 86_400_000).toISOString())).getTime()).toBe(exact);
  });

  it("on handover the open link is set to the warranty end + 1 day (a longer planned expiry doesn't outlive the warranty)", async () => {
    // planned far ahead (long duration), handed over early
    const c = await makeContract(5000, { days: 400, warranty: 6 });
    const before = await newLink(owner, c.id, new Date(Date.now() + 30 * 86_400_000).toISOString());
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1 and is_final", [c.id]));
    const end = (await asAdmin((q) => q<{ d: string }>("select (private.warranty_end($1) + 1)::text as d", [c.id]))).rows[0].d;
    const exact = new Date(`${end}T00:00:00+03:00`).getTime();
    expect(new Date(before).getTime()).toBeGreaterThan(exact);
    const open = await asAdmin((q) => q<{ expires_at: Date }>("select expires_at from public.client_portal_links where contract_id = $1 and revoked_at is null", [c.id]));
    expect(open.rows.length).toBeGreaterThan(0);
    for (const r of open.rows) expect(new Date(r.expires_at).getTime()).toBe(exact);
  });

  it("after the warranty has ended no link can be issued — whoever asks (quotes.manage without projects.view too)", async () => {
    const c = await makeContract(5000, { start: "2025-01-01", days: 10, warranty: 1 });
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() - interval '3 months' where contract_id = $1 and is_final", [c.id]));
    const quoter = await createUser("966500029006");
    await asAdmin((q) => q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":["quotes.view","quotes.manage"],"deny":["projects.view"]}')`, [org, quoter]));
    for (const user of [owner, quoter]) {
      await expect(newLink(user, c.id, new Date(Date.now() + 30 * 86_400_000).toISOString())).rejects.toThrow(/warranty_ended/);
    }
    // the last day of the warranty still counts (Riyadh date)
    await asAdmin((q) => q("update public.project_stages set confirmed_at = now() - interval '1 month' where contract_id = $1 and is_final", [c.id]));
    const today = (await asAdmin((q) => q<{ d: string; w: string }>("select (now() at time zone 'Asia/Riyadh')::date::text as d, private.warranty_end($1)::text as w", [c.id]))).rows[0];
    if (today.w >= today.d) await expect(newLink(owner, c.id, new Date(Date.now() + 30 * 86_400_000).toISOString())).resolves.toBeTruthy();
  });

  it("accepted additional works' days push the planned expiry", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const c = await makeContract(5000, { start, days: 10, warranty: 6 });
    await makeAddendum(c, 1000, 100);
    const got = await newLink(owner, c.id, new Date(Date.now() + 90 * 86_400_000).toISOString());
    const min = new Date(`${start}T00:00:00Z`);
    min.setUTCDate(min.getUTCDate() + 10 + 100 + 30);
    min.setUTCMonth(min.getUTCMonth() + 6);
    expect(new Date(got).getTime()).toBeGreaterThanOrEqual(min.getTime() - 86_400_000);
  });
});

describe("#12 additional works: estimated cost and subcontractor agreements", () => {
  it("only costs.view sees or writes an addendum's estimated cost; per-project access applies", async () => {
    const c = await makeContract(9000);
    const ad = await makeAddendum(c, 2000);
    await as({ userId: sup }, (q) => q("insert into public.addendum_costs (organization_id, addendum_id, material_cost, other_cost) values ($1,$2,700,300)", [org, ad]));
    const row = await as({ userId: fin }, (q) => q<{ contract_id: string; material_cost: string }>("select contract_id, material_cost from public.addendum_costs where addendum_id = $1", [ad]));
    expect(row.rows[0]).toMatchObject({ contract_id: c.id, material_cost: "700.00" });
    // a viewer (no costs.view) sees nothing and can't write
    expect((await as({ userId: viewer }, (q) => q("select 1 from public.addendum_costs where addendum_id = $1", [ad]))).rowCount).toBe(0);
    await expectDenied(as({ userId: viewer }, (q) => q("update public.addendum_costs set material_cost = 1 where addendum_id = $1 returning 1", [ad]).then((r) => { if (!r.rowCount) throw new Error("denied"); })));
    // a supervisor limited to assigned projects doesn't see this one
    expect((await as({ userId: restricted }, (q) => q("select 1 from public.addendum_costs where addendum_id = $1", [ad]))).rowCount).toBe(0);
    // one estimate per addendum (the contract is taken from the addendum)
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.addendum_costs (organization_id, addendum_id, material_cost) values ($1,$2,1)", [org, ad])), /duplicate|unique/);
  });

  it("the addendum's estimated materials stop a false over-budget alert", async () => {
    const c = await makeContract(9000, { materials: 1000 });
    const ad = await makeAddendum(c, 3000);
    await asAdmin(async (q) => {
      const item = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,$2,'bag',false) returning id", [org, "معجون " + c.number])).rows[0].id;
      await q("insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost) values ($1,$2,$3,'issue',10,150)", [org, item, c.id]);
    });
    await as({ userId: owner }, (q) => q("insert into public.addendum_costs (organization_id, addendum_id, material_cost, other_cost) values ($1,$2,600,0)", [org, ad]));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q("select 1 from public.notifications where kind = 'project_over_budget' and dedupe_key like $1", [`budget:${c.id}%`]));
    expect(n.rowCount).toBe(0);
  });

  it("an accepted addendum flags the project's subcontractor agreements for review; editing clears it", async () => {
    const c = await makeContract(9000);
    const g = await as({ userId: owner }, async (q) => {
      const sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name, services) values ($1,$2,'{gypsum}') returning id", [org, "مقاول " + c.number])).rows[0].id;
      return (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule) values ($1,$2,$3,'أسقف','per_m2',15,100,'weekly') returning id", [org, sub, c.id])).rows[0].id;
    });
    const ad = await makeAddendum(c, 1500);
    const flagged = await as({ userId: owner }, (q) => q<{ review_addendum_id: string | null }>("select review_addendum_id from public.subcontractor_agreements where id = $1", [g]));
    expect(flagged.rows[0].review_addendum_id).toBe(ad);
    // purchasing / finance staff are told to review it (once each), with a link to the subcontractors page
    const told = await asAdmin((q) => q<{ user_id: string; link: string; params: { number: string; addendum: string; count: number } }>("select user_id, link, params from public.notifications where kind = 'agreement_review' and dedupe_key = $1 order by user_id", ["agreement_review:" + ad]));
    expect(told.rows.map((r) => r.user_id).sort()).toEqual([owner, sup, fin].sort());
    expect(told.rows[0].link).toBe("/purchases/subcontractors");
    expect(told.rows[0].params).toMatchObject({ number: c.number, count: 1 });
    expect(told.rows.some((r) => r.user_id === viewer || r.user_id === restricted)).toBe(false);
    await as({ userId: owner }, (q) => q("update public.subcontractor_agreements set quantity_m2 = 120 where id = $1", [g]));
    const cleared = await as({ userId: owner }, (q) => q<{ review_addendum_id: string | null }>("select review_addendum_id from public.subcontractor_agreements where id = $1", [g]));
    expect(cleared.rows[0].review_addendum_id).toBeNull();
    // staff can't raise the flag themselves on another addendum's behalf
    await expectDenied(as({ userId: owner }, (q) => q("update public.subcontractor_agreements set review_addendum_id = $2 where id = $1", [g, ad])), /review/);
  });
});

describe("#14 invoices and receipt vouchers are finance documents", () => {
  it("quotes.view alone doesn't read them; finance.view does", async () => {
    const c = await makeContract(4000);
    await as({ userId: fin }, (q) => q("select public.record_client_payment((select id from public.contract_payments where contract_id = $1), current_date, 1000, 'cash', null)", [c.id]));
    const count = (user: string) =>
      as({ userId: user }, (q) => q<{ i: number; r: number }>("select (select count(*)::int from public.invoices where contract_id = $1) as i, (select count(*)::int from public.client_receipts where contract_id = $1) as r", [c.id])).then((r) => r.rows[0]);
    expect(await count(fin)).toEqual({ i: 1, r: 1 });
    expect(await count(viewer)).toEqual({ i: 0, r: 0 });
    expect(await count(sup)).toEqual({ i: 0, r: 0 });
  });
});

describe("#17 warranty maintenance is a project cost", () => {
  it("project_actuals counts maintenance covered by the warranty (we pay); charged-to-client repairs are not our cost", async () => {
    const c = await makeContract(4000);
    await asAdmin((q) => q("insert into public.maintenance_requests (organization_id, contract_id, body, source, covered, cost) values ($1,$2,'تشقق','staff',false,250),($1,$2,'بقعة','staff',true,80)", [org, c.id]));
    const a = await asAdmin((q) => q<{ maintenance: string }>("select maintenance from private.project_actuals($1)", [c.id]));
    expect(Number(a.rows[0].maintenance)).toBe(80);
  });

  it("warranty maintenance on a handed-over project raises project_losing once (within the warranty only)", async () => {
    const c = await makeContract(1000, { materials: 200 });
    await asAdmin(async (q) => {
      await q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1 and is_final", [c.id]);
      await q("insert into public.maintenance_requests (organization_id, contract_id, body, source, covered, cost) values ($1,$2,'تسرب','staff',true,1500)", [org, c.id]);
    });
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const rows = () => asAdmin((q) => q<{ kind: string }>("select kind from public.notifications where dedupe_key like $1 and user_id = $2", [`%${c.id}%`, owner])).then((r) => r.rows.map((x) => x.kind));
    expect((await rows()).filter((k) => k === "project_losing")).toHaveLength(1);
    // handed over: no delay / visit alerts for it
    expect(await rows()).not.toContain("project_delay");
    // after the warranty: nothing new
    const d = await makeContract(1000, { materials: 200, start: "2024-01-01", warranty: 1 });
    await asAdmin(async (q) => {
      await q("update public.project_stages set status = 'confirmed', confirmed_at = '2024-02-01' where contract_id = $1 and is_final", [d.id]);
      await q("insert into public.maintenance_requests (organization_id, contract_id, body, source, covered, cost) values ($1,$2,'تسرب','staff',true,1500)", [org, d.id]);
    });
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const old = await asAdmin((q) => q("select 1 from public.notifications where kind = 'project_losing' and dedupe_key like $1", [`%${d.id}%`]));
    expect(old.rowCount).toBe(0);
  });
});

describe("G4 subcontractor payments and petty cash reach Qoyod", () => {
  it("queues a bill and its payment for each, idempotently, and backfill finds older ones", async () => {
    const c = await makeContract(8000);
    const { g, account } = await as({ userId: owner }, async (q) => {
      const sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name, services) values ($1,'مؤسسة الإتقان','{gypsum}') returning id", [org])).rows[0].id;
      const g = (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, schedule) values ($1,$2,$3,'معجون','lump',8000,'weekly') returning id", [org, sub, c.id])).rows[0].id;
      const account = (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة المشرف') returning id", [org, sup])).rows[0].id;
      return { g, account };
    });
    // before Qoyod is switched on: nothing queued
    const early = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.subcontractor_payments (organization_id, agreement_id, amount, method) values ($1,$2,400,'cash') returning id", [org, g]));
    await as({ userId: owner }, (q) => q("insert into public.qoyod_settings (organization_id, enabled) values ($1, true)", [org]));
    const pay = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.subcontractor_payments (organization_id, agreement_id, amount, method) values ($1,$2,1500,'transfer') returning id", [org, g]));
    const top = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'topup',1000,'تعبئة') returning id", [org, account]));
    const pc = await as({ userId: sup }, (q) => q<{ id: string }>("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description, supplier_name, contract_id) values ($1,$2,'expense',85,'شريط','محل السلامة',$3) returning id", [org, account, c.id]));
    const ret = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'return',200,'استرجاع') returning id", [org, account]));
    const jobs = () => asAdmin((q) => q<{ kind: string; entity_type: string; ref: string; amount: string | null }>("select kind, entity_type, ref, amount from public.qoyod_sync_jobs where organization_id = $1 and entity_type in ('subcontractor_payment','petty_cash') order by ref", [org])).then((r) => r.rows);
    const sp = pay.rows[0].id;
    const pe = pc.rows[0].id;
    expect(await jobs()).toEqual(
      [
        { kind: "bill", entity_type: "petty_cash", ref: `pc:${pe}`, amount: null },
        { kind: "bill_payment", entity_type: "petty_cash", ref: `pcp:${pe}`, amount: "85.00" },
        // top-ups and returns: bank ↔ cash journal entries
        { kind: "transfer", entity_type: "petty_cash", ref: `pct:${top.rows[0].id}`, amount: "1000.00" },
        { kind: "transfer", entity_type: "petty_cash", ref: `pct:${ret.rows[0].id}`, amount: "200.00" },
        { kind: "bill", entity_type: "subcontractor_payment", ref: `sb:${sp}`, amount: null },
        { kind: "bill_payment", entity_type: "subcontractor_payment", ref: `sp:${sp}`, amount: "1500.00" },
      ].sort((a, b) => a.ref.localeCompare(b.ref)),
    );
    // backfill from an earlier date adds the payment made before Qoyod was on (and nothing twice)
    await as({ userId: owner }, (q) => q("select public.qoyod_backfill($1, current_date - 1)", [org]));
    const after = await jobs();
    expect(after.filter((j) => j.ref.endsWith(early.rows[0].id)).map((j) => j.kind).sort()).toEqual(["bill", "bill_payment"]);
    expect(after.length).toBe(8);
  });

  it("the owner can save every Qoyod account choice (salary, cash, subcontracting)", async () => {
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set salary_account_id = 53, cash_account_id = 7, subcontract_account_id = 55 where organization_id = $1", [org]));
    const s = await as({ userId: owner }, (q) => q("select salary_account_id, cash_account_id, subcontract_account_id from public.qoyod_settings where organization_id = $1", [org]));
    expect(s.rows[0]).toEqual({ salary_account_id: 53, cash_account_id: 7, subcontract_account_id: 55 });
  });
});

describe("#2 provisions are flagged (not cash in the forecast)", () => {
  it("seeded end-of-service and annual-leave items are provisions; hr.manage can change the flag", async () => {
    await as({ userId: owner }, (q) => q("select public.seed_employee_cost_items($1)", [org]));
    const rows = await as({ userId: owner }, (q) => q<{ code: string }>("select code from public.employee_cost_items where organization_id = $1 and is_provision order by code", [org]));
    expect(rows.rows.map((r) => r.code)).toEqual(["annual_leave", "eos_accrual"]);
    await as({ userId: owner }, (q) => q("update public.employee_cost_items set is_provision = true where organization_id = $1 and code = 'housing'", [org]));
    const h = await as({ userId: owner }, (q) => q<{ is_provision: boolean }>("select is_provision from public.employee_cost_items where organization_id = $1 and code = 'housing'", [org]));
    expect(h.rows[0].is_provision).toBe(true);
  });
});
