import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string;
let org: string, quote: string, quote2: string, client: string, contract: string, pay: string;
const TOKEN = "tok_" + "h".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const C = `C-${year}-001`;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001801");
  supervisor = await createUser("966500001802");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, supervisor]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    quote2 = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    for (const id of [quote, quote2]) {
      await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, id]);
      await q("select public.issue_quote($1, null)", [id]);
    }
  });
});
afterAll(closePool);

describe("security hardening", () => {
  it("staff can't create a contract that looks accepted", async () => {
    await expectDenied(
      as({ userId: supervisor }, (q) =>
        q("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status, accepted_name, accepted_at) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'accepted','العميل',now())", [org, quote, client]),
      ),
    );
    contract = await as({ userId: supervisor }, (q) =>
      q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id", [org, quote, client]),
    ).then((r) => r.rows[0].id);
  });

  it("staff can't insert or flip payments to paid", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, status, paid_amount) values ($1,$2,1,'x',100,1000,'paid',1000)", [org, contract])));
    pay = await as({ userId: supervisor }, (q) => q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount) values ($1,$2,1,'عند التوقيع',100,1000) returning id", [org, contract])).then((r) => r.rows[0].id);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contract_payments set status = 'paid', paid_amount = 1000 where id = $1", [pay])));
    await as({ userId: owner }, (q) => q("update public.contract_payments set expected_date = current_date + 3 where id = $1", [pay]));
  });

  it("links can only be revoked — never extended or un-revoked by staff", async () => {
    await as({ userId: supervisor }, (q) => q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]));
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.client_portal_links set expires_at = now() + interval '20 years'")));
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [C, TOKEN]));
    await as({ userId: supervisor }, (q) => q("update public.client_portal_links set revoked_at = now()"));
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.client_portal_links set revoked_at = null")));
  });

  it("an accepted contract can't be re-pointed to another quote, client or service", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set quote_id = $1 where id = $2", [quote2, contract])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set notes = 'تعديل' where id = $1", [contract])));
    const row = await asAdmin((q) => q<{ status: string }>("select status from public.contracts where id = $1", [contract]));
    expect(row.rows[0].status).toBe("accepted");
  });

  it("acceptance signatures must be PNG", async () => {
    await expectDenied(asAdmin((q) => q("update public.contracts set accepted_signature = 'data:image/svg+xml;base64,PHN2Zz4=' where id = $1", [contract])));
  });
});
