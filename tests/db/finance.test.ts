import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, finance: string, ownerB: string;
let org: string, contract: string, pay1: string, pay2: string;
const TOKEN = "tok_" + "f".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001201");
  supervisor = await createUser("966500001202");
  finance = await createUser("966500001203");
  ownerB = await createUser("966500001204");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance')", [org, supervisor, finance]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',10000,10000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,10000,'sent') returning id", [org, quote, client])).rows[0].id;
    const p = await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'توقيع',60,6000,'signing'),($1,$2,2,'تسليم',40,4000,'handover') returning id", [org, contract]);
    [pay1, pay2] = p.rows.map((r) => r.id);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [`C-${year}-001`, TOKEN]));
});
afterAll(closePool);

describe("collections", () => {
  it("finance records partial then full payment", async () => {
    const r1 = await as({ userId: finance }, (q) => q<{ s: string }>("select public.record_client_payment($1, current_date, 2500, 'transfer', 'TRX-1') as s", [pay1]));
    expect(r1.rows[0].s).toBe("partial");
    const r2 = await as({ userId: finance }, (q) => q<{ s: string }>("select public.record_client_payment($1, current_date, 3500, 'cash', null) as s", [pay1]));
    expect(r2.rows[0].s).toBe("paid");
    const p = await as({ userId: owner }, (q) => q<{ status: string; paid_amount: string; requested_at: Date | null }>("select status, paid_amount, requested_at from public.contract_payments where id = $1", [pay1]));
    expect(p.rows[0].status).toBe("paid");
    expect(Number(p.rows[0].paid_amount)).toBe(6000);
    expect(p.rows[0].requested_at).not.toBeNull();
  });

  it("supervisors can't record money; nobody marks paid by hand", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("select public.record_client_payment($1, current_date, 100, 'cash', null)", [pay2])), /not allowed/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contract_payments set status = 'paid' where id = $1", [pay2])), /record_client_payment/);
  });

  it("the accepted schedule can't be rewritten; finance may set the expected date", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contract_payments set amount = 1 where id = $1", [pay2])), /can't change/);
    const r = await as({ userId: finance }, (q) => q("update public.contract_payments set expected_date = current_date + 20 where id = $1 returning id", [pay2]));
    expect(r.rowCount).toBe(1);
  });

  it("rejects invalid amounts and future dates", async () => {
    await expectDenied(as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date + 30, 100, 'cash', null)", [pay2])), /invalid/);
    await expectDenied(as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, -5, 'cash', null)", [pay2])), /invalid/);
  });

  it("finance settings are finance-only and isolated", async () => {
    await as({ userId: finance }, (q) => q("insert into public.finance_settings (organization_id, cash_balance) values ($1, 50000)", [org]));
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.finance_settings set cash_balance = 1 returning 1").then((r) => { if (!r.rowCount) throw Object.assign(new Error("denied"), { code: "42501" }); })));
    const b = await as({ userId: ownerB }, (q) => q("select count(*)::int as n from public.finance_settings"));
    expect(b.rows[0].n).toBe(0);
  });
});
