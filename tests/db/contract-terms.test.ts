import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, org: string, contract: string;
const TOKEN = "tok_" + "t".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const C = `C-${new Date().getFullYear()}-001`;
const terms = { custom: [{ id: "c-1234", title: "الكهرباء", body: "على المالك", after: "second" }] };

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500002101");
  supervisor = await createUser("966500002102");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, supervisor]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name, id_number) values ($1,'966500008888','عميل','1000000008') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id", [org, quote, client])).rows[0].id;
    // a contract always has its payment schedule (create_contract); "custom" = never requested by an event
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,1000,'custom')", [org, contract]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
});
afterAll(closePool);

describe("contract clauses", () => {
  it("the company template is edited by settings managers only", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.contract_templates (organization_id, terms) values ($1, $2)", [org, terms])));
    await as({ userId: owner }, (q) => q("insert into public.contract_templates (organization_id, terms) values ($1, $2)", [org, terms]));
    expect((await as({ userId: supervisor }, (q) => q("select 1 from public.contract_templates"))).rowCount).toBe(1);
  });

  it("a contract's clauses change until the client accepts, then freeze; the client page reads them", async () => {
    await as({ userId: supervisor }, (q) => q("update public.contracts set terms = $1 where id = $2", [terms, contract]));
    const r = await as("service_role", (q) => q<{ t: typeof terms }>("select public.portal_contract_terms($1,$2) as t", [C, TOKEN]));
    expect(r.rows[0].t.custom[0].title).toBe("الكهرباء");
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [C, TOKEN]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set terms = '{}' where id = $1", [contract])));
  });
});
