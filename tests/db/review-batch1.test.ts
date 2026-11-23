import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { employeeCost, type CostItem } from "@/lib/costing";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * Review batch 1 (Nov 2026): money & security fixes.
 * #1 addendum payments · #2 signing/material payments requested · #3 approvals can't be bypassed ·
 * #4 stale approvals · #5 payroll advances · #6 per-project access · #8 in-house labour actual cost.
 */
let owner: string, sup: string, fin: string, viewer: string, restricted: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

type Made = { id: string; number: string; quote: string; token: string; payments: string[] };

/** An issued quote → a sent contract with its schedule → (optionally) accepted by the client. */
async function makeContract(total: number, events: string[] = ["signing"], accept = true): Promise<Made> {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',$3,$3)", [org, quote, total]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,$4,'sent') returning id, number", [org, quote, client, total])).rows[0];
    const payments: string[] = [];
    const share = Math.round((total / events.length) * 100) / 100;
    for (const [i, e] of events.entries()) {
      payments.push((await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, c.id, i + 1, `دفعة ${i + 1}`, 100 / events.length, share, e])).rows[0].id);
    }
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, quote, token, payments };
  });
  if (accept) await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}

/** An accepted addendum on a contract (owner submits → approved → sent → client accepts). */
async function makeAddendum(c: Made, total: number): Promise<{ id: string; number: string }> {
  const a = await as({ userId: owner }, async (q) => {
    const row = (await q<{ id: string; number: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, vat, total, extra_days) values ($1,$2,'أعمال إضافية','بيت إنارة إضافي',$3,0,$3,2) returning id, number", [org, c.id, total])).rows[0];
    await q("select public.submit_addendum($1)", [row.id]);
    await q("update public.addenda set status = 'sent' where id = $1", [row.id]);
    return row;
  });
  await as("service_role", (q) => q("select public.portal_accept_addendum($1,$2,$3,'محمد',null,'1.1.1.1','x')", [c.number, c.token, a.id]));
  return a;
}

const today = () => asAdmin((q) => q<{ d: string }>("select to_char((now() at time zone 'Asia/Riyadh')::date, 'YYYY-MM-DD') as d")).then((r) => r.rows[0].d);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009001");
  sup = await createUser("966500009002");
  fin = await createUser("966500009003");
  viewer = await createUser("966500009004");
  restricted = await createUser("966500009005");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance'),($1,$4,'viewer'),($1,$5,'supervisor')", [org, sup, fin, viewer, restricted]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("#1 addendum payments", () => {
  let c: Made, ad: { id: string; number: string };
  beforeAll(async () => {
    c = await makeContract(10000);
    ad = await makeAddendum(c, 1000);
  });

  it("staff can't write payment fields directly (not even on a draft)", async () => {
    const draft = await as({ userId: sup }, async (q) => (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'مسودة','مسودة',500,500) returning id", [org, c.id])).rows[0].id);
    await expectDenied(as({ userId: sup }, (q) => q("update public.addenda set paid_amount = 999 where id = $1", [draft])), /record_addendum_payment/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.addenda set payment_status = 'paid' where id = $1", [ad.id])), /record_addendum_payment/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.addenda set paid_at = current_date where id = $1", [ad.id])), /record_addendum_payment/);
    const rv = await asAdmin((q) => q<{ n: number }>("select count(*)::int as n from public.client_receipts where addendum_id = $1", [draft]));
    expect(rv.rows[0].n).toBe(0);
  });

  it("finance records partial and full amounts cumulatively, with method and reference on each receipt", async () => {
    await expectDenied(as({ userId: sup }, (q) => q("select public.record_addendum_payment($1, current_date, 100, 'cash', null)", [ad.id])), /not allowed/);
    const r1 = await as({ userId: fin }, (q) => q<{ s: string }>("select public.record_addendum_payment($1, current_date, 400, 'transfer', 'TRX-1') as s", [ad.id]));
    expect(r1.rows[0].s).toBe("partial");
    // nothing beyond the amount due
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_addendum_payment($1, current_date, 601, 'cash', null)", [ad.id])), /more than/);
    let a = await asAdmin((q) => q<{ payment_status: string; paid_amount: string }>("select payment_status, paid_amount from public.addenda where id = $1", [ad.id]));
    expect(a.rows[0]).toEqual({ payment_status: "requested", paid_amount: "400.00" });
    const r2 = await as({ userId: fin }, (q) => q<{ s: string }>("select public.record_addendum_payment($1, current_date, 600, 'cash', null) as s", [ad.id]));
    expect(r2.rows[0].s).toBe("paid");
    a = await asAdmin((q) => q("select payment_status, paid_amount from public.addenda where id = $1", [ad.id]));
    expect(a.rows[0]).toEqual({ payment_status: "paid", paid_amount: "1000.00" });
    const rv = await asAdmin((q) => q<{ amount: string; method: string; reference: string | null }>("select amount, method, reference from public.client_receipts where addendum_id = $1 order by number", [ad.id]));
    expect(rv.rows.map((x) => [Number(x.amount), x.method, x.reference])).toEqual([[400, "transfer", "TRX-1"], [600, "cash", null]]);
    // once paid in full, nothing more
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_addendum_payment($1, current_date, 1, 'cash', null)", [ad.id])), /already paid/);
  });

  it("only accepted addenda can be paid", async () => {
    const draft = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'مسودة ٢','مسودة',500,500) returning id", [org, c.id])).rows[0].id);
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_addendum_payment($1, current_date, 100, 'cash', null)", [draft])), /accepted/);
  });

  it("money received on an addendum notifies finance with a link to the collections report", async () => {
    const n = await asAdmin((q) => q<{ link: string }>("select link from public.notifications where kind = 'payment_received' and user_id = $1 and params ->> 'label' like $2", [fin, `${ad.number}%`]));
    expect(n.rows.length).toBe(2);
    expect(n.rows[0].link).toBe("/reports");
  });

  it("late addendum payments are reminded like contract payments", async () => {
    const late = await makeAddendum(c, 300);
    await asAdmin((q) => q("update public.addenda set accepted_at = now() - interval '7 days' where id = $1", [late.id]));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q<{ link: string; params: { amount: number } }>("select link, params from public.notifications where kind = 'payment_late' and user_id = $1 and dedupe_key like $2", [fin, `late:${late.id}:%`]));
    expect(n.rows).toHaveLength(1);
    expect(n.rows[0].link).toBe("/reports");
    expect(Number(n.rows[0].params.amount)).toBe(300);
  });
});

describe("#2 payments become requested", () => {
  it("the signing payment is requested when the client accepts (invoice issued)", async () => {
    const c = await makeContract(9000, ["signing", "material_supply", "board_closing"]);
    const p = await asAdmin((q) => q<{ due_event: string; status: string; requested_at: string | null }>("select due_event, status, requested_at from public.contract_payments where contract_id = $1 order by seq", [c.id]));
    expect(p.rows.map((x) => [x.due_event, x.status])).toEqual([["signing", "requested"], ["material_supply", "pending"], ["board_closing", "pending"]]);
    expect(p.rows[0].requested_at).not.toBeNull();
    const inv = await asAdmin((q) => q<{ n: number }>("select count(*)::int as n from public.invoices where payment_id = $1", [c.payments[0]]));
    expect(inv.rows[0].n).toBe(1);
  });

  it("staff request material-supply and custom payments; stage payments stay with the client's confirmation", async () => {
    const c = await makeContract(9000, ["signing", "material_supply", "handover"]);
    await expectDenied(as({ userId: viewer }, (q) => q("select public.request_contract_payment($1)", [c.payments[1]])), /not allowed/);
    await as({ userId: fin }, (q) => q("select public.request_contract_payment($1)", [c.payments[1]]));
    const s = await asAdmin((q) => q<{ status: string }>("select status from public.contract_payments where id = $1", [c.payments[1]]));
    expect(s.rows[0].status).toBe("requested");
    await expectDenied(as({ userId: sup }, (q) => q("select public.request_contract_payment($1)", [c.payments[2]])), /stage/);
    const notAccepted = await makeContract(5000, ["signing", "custom"], false);
    await expectDenied(as({ userId: fin }, (q) => q("select public.request_contract_payment($1)", [notAccepted.payments[1]])), /accepted/);
  });
});

describe("#3 owner approval can't be bypassed", () => {
  let quote: string;
  beforeAll(async () => {
    quote = await as({ userId: sup }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      const v = (await q<{ id: string }>("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',5000,5000) returning id", [org, id])).rows[0].id;
      await q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) values ($1,$2,4500,4500,10,'[]','[]')", [v, org]);
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"version\":1}')", [org, id]);
      await q("update public.quotes set status = 'pending_approval' where id = $1", [id]);
      return id;
    });
  });

  it("staff can't write 'issued' or 'accepted' directly", async () => {
    await expectDenied(as({ userId: sup }, (q) => q("update public.quotes set status = 'issued' where id = $1", [quote])), /issue_quote/);
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'gypsum','issued')", [org, client])), /issue_quote/);
  });

  it("issue_quote refuses while the approval is open, and without an approved one for a low margin", async () => {
    await expectDenied(as({ userId: sup }, (q) => q("select public.issue_quote($1, null)", [quote])), /approval/);
    // someone cancels the pending approval directly → still refused (margin below minimum, no approved approval)
    await asAdmin((q) => q("update public.approvals set status = 'cancelled' where entity_id = $1", [quote]));
    await expectDenied(as({ userId: sup }, (q) => q("select public.issue_quote($1, null)", [quote])), /approval/);
    await as({ userId: sup }, (q) => q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"version\":1}')", [org, quote]));
    await as({ userId: owner }, (q) => q("update public.approvals set status = 'approved' where entity_id = $1 and status = 'pending'", [quote]));
    await as({ userId: sup }, (q) => q("select public.issue_quote($1, current_date + 7)", [quote]));
    const s = await asAdmin((q) => q<{ status: string }>("select status from public.quotes where id = $1", [quote]));
    expect(s.rows[0].status).toBe("issued");
  });

  it("a new version on an issued quote sends it back to draft", async () => {
    const q2 = await as({ userId: owner }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',100,100)", [org, id]);
      await q("select public.issue_quote($1, null)", [id]);
      return id;
    });
    await as({ userId: sup }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, q2]));
    const s = await asAdmin((q) => q<{ status: string }>("select status from public.quotes where id = $1", [q2]));
    expect(s.rows[0].status).toBe("draft");
  });

  it("a contract needs an issued quote and takes its total from the quote version", async () => {
    const draft = await as({ userId: sup }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',100,100)", [org, id]);
      return id;
    });
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,5,100)", [org, draft, client])), /issued/);
    const c = await as({ userId: sup }, async (q) => (await q<{ id: string; total: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,5,1) returning id, total", [org, quote, client])).rows[0]);
    expect(Number(c.total)).toBe(5000);
    const u = await as({ userId: sup }, (q) => q<{ total: string }>("update public.contracts set total = 2 where id = $1 returning total", [c.id]));
    expect(Number(u.rows[0].total)).toBe(5000);
  });
});

describe("#4 stale approvals", () => {
  it("a new version supersedes older pending approvals even when saved by a supervisor", async () => {
    const quote = await as({ userId: sup }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',100,100)", [org, id]);
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_discount','quote',$2,'{\"version\":1}')", [org, id]);
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',100,100)", [org, id]);
      return id;
    });
    const a = await asAdmin((q) => q<{ status: string }>("select status from public.approvals where entity_id = $1", [quote]));
    expect(a.rows.map((x) => x.status)).toEqual(["cancelled"]);
  });

  it("dropping options cancels the dropped versions' pending approvals", async () => {
    const quote = await as({ userId: sup }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      for (let i = 0; i < 2; i++) await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',100,100)", [org, id]);
      await q("update public.quotes set options = '[{\"version\":1,\"label\":\"أ\"},{\"version\":2,\"label\":\"ب\"}]' where id = $1", [id]);
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"version\":1}'),($1,'quote_margin','quote',$2,'{\"version\":2}')", [org, id]);
      await q("update public.quotes set options = null where id = $1", [id]);
      return id;
    });
    const a = await asAdmin((q) => q<{ v: string; status: string }>("select details ->> 'version' as v, status from public.approvals where entity_id = $1 order by 1", [quote]));
    expect(a.rows).toEqual([{ v: "1", status: "cancelled" }, { v: "2", status: "pending" }]);
  });

  it("an accepted quote never goes back to draft", async () => {
    const c = await makeContract(100);
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set status = 'draft' where id = $1", [c.quote])), /accepted/);
  });
});

describe("#5 payroll advances", () => {
  it("settles only what the line deducts; the rest carries to next month", async () => {
    const { emp, run } = await as({ userId: owner }, async (q) => {
      const emp = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, basic_salary) values ($1,'خالد',3000) returning id", [org])).rows[0].id;
      await q("insert into public.employee_advances (organization_id, employee_id, amount) values ($1,$2,500)", [org, emp]);
      const run = (await q<{ id: string }>("select public.create_payroll_run($1, '2026-10-01') as id", [org])).rows[0].id;
      return { emp, run };
    });
    // an advance given after the month was prepared, and the line edited to deduct 200 only
    await as({ userId: owner }, async (q) => {
      await q("insert into public.employee_advances (organization_id, employee_id, amount) values ($1,$2,300)", [org, emp]);
      await q("update public.payroll_lines set advances = 200 where run_id = $1 and employee_id = $2", [run, emp]);
    });
    await as({ userId: owner }, (q) => q("select public.approve_payroll_run($1)", [run]));
    const adv = await asAdmin((q) => q<{ amount: string; deducted_amount: string; settled: boolean }>("select amount, deducted_amount, deducted_in_run is not null as settled from public.employee_advances where employee_id = $1 order by amount desc", [emp]));
    expect(adv.rows.map((x) => [Number(x.amount), Number(x.deducted_amount), x.settled])).toEqual([[500, 200, false], [300, 0, false]]);
    const next = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_payroll_run($1, '2026-11-01') as id", [org])).rows[0].id);
    const line = await asAdmin((q) => q<{ advances: string }>("select advances from public.payroll_lines where run_id = $1 and employee_id = $2", [next, emp]));
    expect(Number(line.rows[0].advances)).toBe(600);
    await as({ userId: owner }, (q) => q("select public.approve_payroll_run($1)", [next]));
    const left = await asAdmin((q) => q<{ n: number }>("select count(*)::int as n from public.employee_advances where employee_id = $1 and deducted_in_run is null", [emp]));
    expect(left.rows[0].n).toBe(0);
  });

  it("a line can't deduct more than the employee's open advances; deducted amounts aren't writable", async () => {
    const { emp, adv, run } = await as({ userId: owner }, async (q) => {
      const emp = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, basic_salary) values ($1,'ماجد',3000) returning id", [org])).rows[0].id;
      const adv = (await q<{ id: string }>("insert into public.employee_advances (organization_id, employee_id, amount) values ($1,$2,100) returning id", [org, emp])).rows[0].id;
      return { emp, adv, run: (await q<{ id: string }>("select public.create_payroll_run($1, '2026-09-01') as id", [org])).rows[0].id };
    });
    await expectDenied(as({ userId: owner }, (q) => q("update public.employee_advances set deducted_amount = 100 where id = $1", [adv])));
    await as({ userId: owner }, (q) => q("update public.payroll_lines set advances = 150 where run_id = $1 and employee_id = $2", [run, emp]));
    await expectDenied(as({ userId: owner }, (q) => q("select public.approve_payroll_run($1)", [run])), /open advances/);
  });
});

describe("#6 per-project access", () => {
  let hidden: Made, visible: Made, item: string;
  beforeAll(async () => {
    hidden = await makeContract(1000);
    visible = await makeContract(1000);
    await as({ userId: owner }, async (q) => {
      await q("insert into public.project_members (organization_id, contract_id, user_id) values ($1,$2,$3)", [org, visible.id, restricted]);
      item = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,'لوح','board',true) returning id", [org])).rows[0].id;
      const p = (await q<{ id: string }>("insert into public.purchases (organization_id, supplier_name, contract_id, subtotal, vat, total) values ($1,'مورد',$2,100,0,100) returning id", [org, hidden.id])).rows[0].id;
      await q("insert into public.purchase_lines (organization_id, purchase_id, seq, kind, item_id, description, quantity, unit_price, amount) values ($1,$2,1,'material',$3,'لوح',10,10,100)", [org, p, item]);
      await q("select public.submit_purchase($1)", [p]);
      const sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1,'مقاول') returning id", [org])).rows[0].id;
      const g = (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, schedule) values ($1,$2,$3,'نطاق','lump',1000,'weekly') returning id", [org, sub, hidden.id])).rows[0].id;
      await q("insert into public.subcontractor_work (organization_id, agreement_id, percent, amount) values ($1,$2,10,0)", [org, g]);
      await q("insert into public.subcontractor_payments (organization_id, agreement_id, amount) values ($1,$2,50)", [org, g]);
    });
  });

  it("a restricted member can't move stock, submit purchases or addenda of a hidden project", async () => {
    await expectDenied(as({ userId: restricted }, (q) => q("select public.move_stock($1, 1, $2, null)", [item, hidden.id])), /not allowed/);
    await expectDenied(as({ userId: restricted }, (q) => q("select public.move_stock($1, 1, null, $2)", [item, hidden.id])), /not allowed/);
    const { p, a } = await as({ userId: owner }, async (q) => {
      const p = (await q<{ id: string }>("insert into public.purchases (organization_id, supplier_name, contract_id, subtotal, vat, total) values ($1,'مورد',$2,10,0,10) returning id", [org, hidden.id])).rows[0].id;
      await q("insert into public.purchase_lines (organization_id, purchase_id, seq, kind, description, quantity, unit_price, amount) values ($1,$2,1,'expense','نقل',1,10,10)", [org, p]);
      const a = (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'إضافي','إضافي',10,10) returning id", [org, hidden.id])).rows[0].id;
      return { p, a };
    });
    await expectDenied(as({ userId: restricted }, (q) => q("select public.submit_purchase($1)", [p])), /not allowed/);
    await expectDenied(as({ userId: restricted }, (q) => q("select public.submit_addendum($1)", [a])), /not allowed/);
  });

  it("purchase lines, subcontractor work and payments of a hidden project are hidden", async () => {
    const n = await as({ userId: restricted }, (q) => q<{ l: number; w: number; p: number }>("select (select count(*)::int from public.purchase_lines) as l, (select count(*)::int from public.subcontractor_work) as w, (select count(*)::int from public.subcontractor_payments) as p"));
    expect(n.rows[0]).toEqual({ l: 0, w: 0, p: 0 });
    const o = await as({ userId: sup }, (q) => q<{ l: number; w: number }>("select (select count(*)::int from public.purchase_lines) as l, (select count(*)::int from public.subcontractor_work) as w"));
    expect(o.rows[0].l).toBeGreaterThan(0);
    expect(o.rows[0].w).toBeGreaterThan(0);
  });

  it("warranties list only visible projects", async () => {
    await asAdmin(async (q) => {
      for (const c of [hidden, visible]) await q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1", [c.id]);
    });
    const w = await as({ userId: restricted }, (q) => q<{ number: string }>("select number from public.contract_warranties($1)", [org]));
    expect(w.rows.map((r) => r.number)).toEqual([visible.number]);
  });

  it("payment notifications carry the contract and link to collections (hidden projects skip restricted members)", async () => {
    await as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, 10, 'cash', null)", [hidden.payments[0]]));
    const n = await asAdmin((q) => q<{ user_id: string; link: string }>("select user_id, link from public.notifications where kind = 'payment_received' and params ->> 'number' = $1", [hidden.number]));
    expect(n.rows.length).toBeGreaterThan(0);
    expect(n.rows.every((r) => r.link === "/reports")).toBe(true);
    // an explicit contract is honoured even when the link names no project
    await asAdmin((q) => q("select private.notify($1,'projects.view','project_delay','{}'::jsonb,'/reports','x6',$2)", [org, hidden.id]));
    const got = await asAdmin((q) => q<{ user_id: string }>("select user_id from public.notifications where dedupe_key = 'x6'"));
    expect(got.rows.map((r) => r.user_id)).not.toContain(restricted);
    expect(got.rows.map((r) => r.user_id)).toContain(sup);
  });

  it("approval notifications link to the item awaiting the decision", async () => {
    const number = await as({ userId: sup }, async (q) => {
      const r = (await q<{ id: string; number: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id, number", [org, client])).rows[0];
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_discount','quote',$2,jsonb_build_object('version',1,'number',$3::text))", [org, r.id, r.number]);
      return r.number;
    });
    const n = await asAdmin((q) => q<{ link: string }>("select link from public.notifications where kind = 'approval' and params ->> 'number' = $1", [number]));
    expect(n.rows[0].link).toBe(`/quotations/${number}`);
  });
});

describe("#8 in-house labour actual cost", () => {
  const items: CostItem[] = [
    { code: "gosi", applies_to: "all", basis: "percent", value: 2, amortize_months: null, is_active: true },
    { code: "levy", applies_to: "non_saudi", basis: "monthly", value: 100, amortize_months: null, is_active: true },
    { code: "insurance", applies_to: "all", basis: "annual", value: 1200, amortize_months: null, is_active: true },
    { code: "visa", applies_to: "non_saudi", basis: "one_time", value: 2400, amortize_months: 24, is_active: true },
    { code: "saned", applies_to: "saudi", basis: "percent", value: 10, amortize_months: null, is_active: true },
    { code: "old", applies_to: "all", basis: "monthly", value: 999, amortize_months: null, is_active: false },
  ];
  const e1 = { is_saudi: false, basic_salary: 3000, housing_allowance: 750, transport_allowance: 300, other_allowances: 0 };
  const e2 = { is_saudi: true, basic_salary: 5000, housing_allowance: 1250, transport_allowance: 500, other_allowances: 250 };
  let c: Made, emp1: string, emp2: string;

  beforeAll(async () => {
    c = await makeContract(20000);
    await as({ userId: owner }, async (q: Q) => {
      await q("insert into public.pricing_settings (organization_id, working_days_per_month) values ($1, 25) on conflict (organization_id) do update set working_days_per_month = 25", [org]);
      for (const i of items) {
        await q("insert into public.employee_cost_items (organization_id, code, name_ar, applies_to, basis, value, amortize_months, is_active) values ($1,$2,'بند',$3,$4,$5,$6,$7) on conflict (organization_id, code) do update set applies_to = excluded.applies_to, basis = excluded.basis, value = excluded.value, amortize_months = excluded.amortize_months, is_active = excluded.is_active", [org, i.code, i.applies_to, i.basis, i.value, i.amortize_months, i.is_active]);
      }
      // only the items above count
      await q("update public.employee_cost_items set is_active = false where organization_id = $1 and code <> all($2::text[])", [org, items.map((i) => i.code)]);
      emp1 = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances) values ($1,'عامل ١',false,3000,750,300,0) returning id", [org])).rows[0].id;
      emp2 = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, is_saudi, basic_salary, housing_allowance, transport_allowance, other_allowances) values ($1,'عامل ٢',true,5000,1250,500,250) returning id", [org])).rows[0].id;
      const team = (await q<{ id: string }>("insert into public.teams (organization_id, name, kind) values ($1,'فريقنا','inhouse') returning id", [org])).rows[0].id;
      await q("insert into public.team_members (organization_id, team_id, employee_id) values ($1,$2,$3),($1,$2,$4)", [org, team, emp1, emp2]);
      const d = "(now() at time zone 'Asia/Riyadh')::date";
      await q(`insert into public.schedule_entries (organization_id, team_id, contract_id, kind, start_date, end_date) values ($1,$2,$3,'work',${d} - 4,${d} + 5),($1,$2,$3,'work',${d} + 10,${d} + 12),($1,$2,null,'leave',${d} - 4,${d})`, [org, team, c.id]);
    });
  });

  it("counts work days only — a full week Saturday to Friday is 6 days", async () => {
    const r = await asAdmin((q) => q<{ n: number }>("select private.work_days('2026-11-21', '2026-11-27') as n"));
    expect(Number(r.rows[0].n)).toBe(6);
    const fri = await asAdmin((q) => q<{ n: number }>("select private.work_days('2026-11-27', '2026-11-27') as n"));
    expect(Number(fri.rows[0].n)).toBe(0);
  });

  it("the database cost per worker-day matches employeeCost() in TypeScript", async () => {
    const r = await asAdmin((q) => q<{ a: string; b: string }>("select private.employee_day_cost($1)::text as a, private.employee_day_cost($2)::text as b", [emp1, emp2]));
    expect(Number(r.rows[0].a)).toBeCloseTo(employeeCost(e1, items, 25).perDay, 6);
    expect(Number(r.rows[0].b)).toBeCloseTo(employeeCost(e2, items, 25).perDay, 6);
  });

  it("project labour = scheduled work days up to today × the team's daily cost (alerts use it too)", async () => {
    const perDay = employeeCost(e1, items, 25).perDay + employeeCost(e2, items, 25).perDay;
    const a = await asAdmin((q) => q<{ labour: string }>("select labour from private.project_actuals($1)", [c.id]));
    // work days only: Friday is the weekly rest day (26 working days a month)
    const { rows: [wd] } = await asAdmin((q) => q<{ n: string }>("select count(*) as n from generate_series((now() at time zone 'Asia/Riyadh')::date - 4, (now() at time zone 'Asia/Riyadh')::date, interval '1 day') g where extract(isodow from g) <> 5"));
    const days = Number(wd.n);
    expect(Number(a.rows[0].labour)).toBeCloseTo(days * perDay, 2);
    const rpc = await as({ userId: owner }, (q) => q<{ contract_id: string; labour: string }>("select * from public.project_labour_costs($1)", [org]));
    expect(Number(rpc.rows.find((x) => x.contract_id === c.id)?.labour)).toBeCloseTo(days * perDay, 2);
    await expectDenied(as({ userId: viewer }, (q) => q("select * from public.project_labour_costs($1)", [org])), /not allowed/);
    // a supervisor sees costs but not salaries: team labour would reveal them
    await expectDenied(as({ userId: sup }, (q) => q("select * from public.project_labour_costs($1)", [org])), /not allowed/);
    await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":["hr.view"],"deny":[]}' where organization_id = $1 and user_id = $2`, [org, restricted]));
    const hiddenFromRestricted = await as({ userId: restricted }, (q) => q<{ contract_id: string }>("select contract_id from public.project_labour_costs($1)", [org]));
    expect(hiddenFromRestricted.rows.map((x) => x.contract_id)).not.toContain(c.id);
  });

  it("team cost not absorbed by projects this month (costs.view + finance.view, totals only)", async () => {
    const perDay = employeeCost(e1, items, 25).perDay + employeeCost(e2, items, 25).perDay;
    const monthly = employeeCost(e1, items, 25).monthlyTotal + employeeCost(e2, items, 25).monthlyTotal;
    const t = await today();
    // work days (no Fridays) booked this month, and the share of the month gone so far
    const workDays = (from: number, to: number) => {
      let n = 0;
      for (let d = from; d <= to; d += 86_400_000) if (new Date(d).getUTCDay() !== 5) n++;
      return n;
    };
    const monthStart = Date.parse(`${t.slice(0, 7)}-01`);
    const monthEnd = Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0);
    const days = workDays(Math.max(monthStart, Date.parse(t) - 4 * 86_400_000), Date.parse(t));
    const r = await as({ userId: owner }, (q) => q<{ monthly: string; allocated: string; to_date: string }>("select * from public.team_cost_month($1)", [org]));
    expect(Number(r.rows[0].monthly)).toBeCloseTo(monthly, 2);
    expect(Number(r.rows[0].allocated)).toBeCloseTo(days * perDay, 2);
    expect(Number(r.rows[0].to_date)).toBeCloseTo((monthly * workDays(monthStart, Date.parse(t))) / workDays(monthStart, monthEnd), 1);
    await expectDenied(as({ userId: sup }, (q) => q("select * from public.team_cost_month($1)", [org])), /not allowed/);
    // finance without hr.view (salaries) doesn't see team cost either
    await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":[],"deny":["hr.view"]}' where organization_id = $1 and user_id = $2`, [org, fin]));
    try {
      await expectDenied(as({ userId: fin }, (q) => q("select * from public.team_cost_month($1)", [org])), /not allowed/);
      await expectDenied(as({ userId: fin }, (q) => q("select * from public.project_labour_costs($1)", [org])), /not allowed/);
    } finally {
      await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":[],"deny":[]}' where organization_id = $1 and user_id = $2`, [org, fin]));
    }
  });

  it("a team booked on two projects the same day is shared between them, not charged twice", async () => {
    const c2 = await makeContract(8000);
    const team = (await asAdmin((q) => q<{ id: string }>("select id from public.teams where organization_id = $1 and name = 'فريقنا'", [org]))).rows[0].id;
    // the day before yesterday, if it isn't a Friday: book the team on c2 too
    const { rows: [d] } = await asAdmin((q) => q<{ d: string; fri: boolean }>("select to_char(x, 'YYYY-MM-DD') as d, extract(isodow from x) = 5 as fri from (select (now() at time zone 'Asia/Riyadh')::date - 2 as x) s"));
    await asAdmin((q) => q("insert into public.schedule_entries (organization_id, team_id, contract_id, kind, start_date, end_date) values ($1,$2,$3,'work',$4,$4)", [org, team, c2.id, d.d]));
    const perDay = employeeCost(e1, items, 25).perDay + employeeCost(e2, items, 25).perDay;
    const a2 = await asAdmin((q) => q<{ labour: string }>("select labour from private.project_actuals($1)", [c2.id]));
    expect(Number(a2.rows[0].labour)).toBeCloseTo(d.fri ? 0 : perDay / 2, 2);
    // and the total charged that day across both projects is one team-day
    const both = await asAdmin((q) => q<{ t: string }>("select private.project_labour($1, $3::date, $3::date) + private.project_labour($2, $3::date, $3::date) as t", [c.id, c2.id, d.d]));
    expect(Number(both.rows[0].t)).toBeCloseTo(d.fri ? 0 : perDay, 2);
    // the month's absorbed team cost doesn't change: the shared day is still one team-day
    const before = await as({ userId: owner }, (q) => q<{ allocated: string }>("select allocated from public.team_cost_month($1)", [org]));
    await asAdmin((q) => q("delete from public.schedule_entries where contract_id = $1", [c2.id]));
    const after = await as({ userId: owner }, (q) => q<{ allocated: string }>("select allocated from public.team_cost_month($1)", [org]));
    expect(Number(before.rows[0].allocated)).toBeCloseTo(Number(after.rows[0].allocated), 2);
  });
});

describe("review findings on batch 1", () => {
  it("an addendum marked paid before this change can't be paid again", async () => {
    const c = await makeContract(4000);
    const ad = await makeAddendum(c, 700);
    // legacy row: status paid, no amount recorded
    await asAdmin(async (q) => {
      await q("alter table public.addenda disable trigger user");
      await q("update public.addenda set payment_status = 'paid' where id = $1", [ad.id]);
      await q("alter table public.addenda enable trigger user");
    });
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_addendum_payment($1, current_date, 700, 'cash', null)", [ad.id])), /already paid/);
  });

  it("a payment whose stage doesn't exist on the project can be requested by staff", async () => {
    const c = await makeContract(6000, ["signing", "primer_done"]);
    const stages = await asAdmin((q) => q<{ n: number }>("select count(*)::int as n from public.project_stages where contract_id = $1 and payment_event = 'primer_done'", [c.id]));
    expect(stages.rows[0].n).toBe(0);
    await as({ userId: fin }, (q) => q("select public.request_contract_payment($1)", [c.payments[1]]));
    expect((await asAdmin((q) => q<{ status: string }>("select status from public.contract_payments where id = $1", [c.payments[1]]))).rows[0].status).toBe("requested");
  });

  it("a quote with unpriced items can't be issued, and an accepted quote's version is frozen", async () => {
    const quote = await as({ userId: owner }, async (q) => {
      const id = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total, problems) values ($1,$2,1,'{}','{}','{}',100,100,2)", [org, id]);
      return id;
    });
    await expectDenied(as({ userId: owner }, (q) => q("select public.issue_quote($1, null)", [quote])), /unpriced/);
    const c = await makeContract(3000);
    await asAdmin((q) => q("update public.quotes set status = 'accepted' where id = $1", [c.quote]));
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,2,'{}','{}','{}',1,1)", [org, c.quote])), /accepted/);
  });

  it("a version's unpriced count can't be negative", async () => {
    const id = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total, problems) values ($1,$2,1,'{}','{}','{}',1,1,-1)", [org, id])), /problems/);
  });

  it("a payment requested with an earlier request time keeps it, and its invoice is dated then", async () => {
    const c = await makeContract(5000, ["signing", "custom"]);
    // what the signing backfill does: requested at the acceptance, not now
    await asAdmin((q) => q("update public.contract_payments set status = 'requested', requested_at = now() - interval '20 days' where id = $1", [c.payments[1]]));
    const r = await asAdmin((q) => q<{ same: boolean }>("select i.issue_date = ((p.requested_at at time zone 'Asia/Riyadh')::date) and p.requested_at < now() - interval '19 days' as same from public.invoices i join public.contract_payments p on p.id = i.payment_id where p.id = $1", [c.payments[1]]));
    expect(r.rows[0].same).toBe(true);
  });

  it("alerts link to the screen that explains them", async () => {
    const c = await makeContract(3000);
    await asAdmin(async (q) => {
      // started 14 days ago, due yesterday, never visited
      await q("update public.contracts set start_date = (now() at time zone 'Asia/Riyadh')::date - 14, duration_days = 13 where id = $1", [c.id]);
      const qv = (await q<{ id: string }>("select v.id from public.quote_versions v where v.quote_id = $1 and v.version = 1", [c.quote])).rows[0].id;
      await q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) values ($1,$2,100,100,30,'[{\"group\":\"material\",\"cost\":100}]','[]')", [qv, org]);
      const item = (await q<{ id: string }>("insert into public.inventory_items (organization_id, name, unit, is_general) values ($1,'دهان','pail',false) returning id", [org])).rows[0].id;
      await q("insert into public.inventory_movements (organization_id, item_id, contract_id, kind, quantity, unit_cost) values ($1,$2,$3,'issue',10,500)", [org, item, c.id]);
    });
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q<{ kind: string; link: string }>("select distinct kind, link from public.notifications where dedupe_key ~ ('^(delay|visit|budget|losing):' || $1) order by kind", [c.id]));
    expect(n.rows).toEqual([
      { kind: "missed_visit", link: `/projects/${c.number}` },
      { kind: "project_delay", link: `/projects/${c.number}` },
      { kind: "project_losing", link: "/purchases/costs" },
      { kind: "project_over_budget", link: "/purchases/costs" },
    ]);
  });

  it("private helpers open to signed-in users answer only about their own organization", async () => {
    const outsider = await createUser("966500009099");
    const c = await makeContract(2000);
    const { purchase, agreement } = await as({ userId: owner }, async (q) => {
      const purchase = (await q<{ id: string }>("insert into public.purchases (organization_id, supplier_name, contract_id, subtotal, vat, total) values ($1,'مورد',$2,0,0,0) returning id", [org, c.id])).rows[0].id;
      const sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1,'مقاول خاص') returning id", [org])).rows[0].id;
      const agreement = (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, schedule) values ($1,$2,$3,'نطاق','lump',100,'weekly') returning id", [org, sub, c.id])).rows[0].id;
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"version\":1}')", [org, c.quote]);
      return { purchase, agreement };
    });
    const sql = "select private.quote_status($1) as status, private.quote_version_total($1, 1) as total, private.quote_has_open_approvals($1, array[1]) as open, private.purchase_contract($2) as pc, private.agreement_contract($3) as ac, cardinality(private.member_permissions($4, $5)) as perms";
    const mine = await as({ userId: sup }, (q) => q<{ status: string | null; total: string | null; open: boolean; pc: string | null; ac: string | null; perms: number }>(sql, [c.quote, purchase, agreement, org, owner]));
    expect(mine.rows[0]).toMatchObject({ status: "accepted", open: true, pc: c.id, ac: c.id });
    expect(Number(mine.rows[0].total)).toBe(2000);
    expect(mine.rows[0].perms).toBeGreaterThan(0);
    const theirs = await as({ userId: outsider }, (q) => q(sql, [c.quote, purchase, agreement, org, owner]));
    expect(theirs.rows[0]).toEqual({ status: null, total: null, open: false, pc: null, ac: null, perms: 0 });
    await expectDenied(as({ userId: outsider }, (q) => q("select private.average_cost($1, null)", [purchase])), /permission denied/);
  });
});
