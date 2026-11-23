import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, finance: string, ownerB: string;
let org: string, contract: string, pay1: string;
const TOKEN = "tok_" + "r".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001601");
  finance = await createUser("966500001602");
  ownerB = await createUser("966500001603");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'finance')", [org, finance]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',10000,10000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,10000,'sent') returning id", [org, quote, client])).rows[0].id;
    pay1 = (await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'عند التوقيع',100,10000,'signing') returning id", [org, contract])).rows[0].id;
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [`C-${year}-001`, TOKEN]));
});
afterAll(closePool);

describe("receipt vouchers", () => {
  it("every amount received gets its own numbered voucher", async () => {
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 4000, 'transfer', 'TRX-9')", [pay1]));
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 6000, 'cash', null)", [pay1]));
    const r = await as({ userId: finance }, (q) => q<{ number: string; amount: string; method: string; reference: string | null; label: string }>("select number, amount, method, reference, label from public.client_receipts order by number"));
    expect(r.rows.map((x) => [x.number, Number(x.amount), x.method, x.reference])).toEqual([
      [`RV-${year}-001`, 4000, "transfer", "TRX-9"],
      [`RV-${year}-002`, 6000, "cash", null],
    ]);
    expect(r.rows[0].label).toBe("عند التوقيع");
  });

  it("vouchers can't be created, changed or deleted by users, and stay inside the organization", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.client_receipts (organization_id, contract_id, payment_id, label, amount, paid_on) values ($1,$2,$3,'x',1,current_date)", [org, contract, pay1])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.client_receipts set amount = 1")));
    await expectDenied(as({ userId: owner }, (q) => q("delete from public.client_receipts")));
    expect((await as({ userId: ownerB }, (q) => q("select * from public.client_receipts"))).rowCount).toBe(0);
  });

  it("the client sees their vouchers with the page token only", async () => {
    const ok = await as("service_role", (q) => q<{ r: { number: string }[] }>("select public.portal_receipts($1,$2) as r", [`C-${year}-001`, TOKEN]));
    expect(ok.rows[0].r.map((x) => x.number)).toEqual([`RV-${year}-001`, `RV-${year}-002`]);
    const bad = await as("service_role", (q) => q<{ r: unknown }>("select public.portal_receipts($1,$2) as r", [`C-${year}-001`, "tok_" + "z".repeat(40)]));
    expect(bad.rows[0].r).toBeNull();
    await expectDenied(as("anon", (q) => q("select public.portal_receipts($1,$2)", [`C-${year}-001`, TOKEN])));
  });
});
