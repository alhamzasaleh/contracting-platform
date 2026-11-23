import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, viewer: string;
let org: string, orgB: string, client: string, quote: string, contract: string;
const year = new Date().getFullYear();
const TOKEN = "tok_" + "x".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000601");
  ownerB = await createUser("966500000602");
  viewer = await createUser("966500000603");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'أبو محمد','966551234567') returning id", [org])).rows[0].id;
    quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'interior','issued') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{\"total\":10000}',10000,10000)", [org, quote]);
  });
});
afterAll(closePool);

describe("contracts", () => {
  it("numbers contracts and stores the schedule", async () => {
    const r = await as({ userId: owner }, async (q) => {
      const c = await q<{ id: string; number: string }>(
        "insert into public.contracts (organization_id, number, quote_id, quote_version, client_id, service, project_type, start_date, duration_days, total, status) values ($1,null,$2,1,$3,'interior','full',current_date + 7,12,10000,'sent') returning id, number",
        [org, quote, client],
      );
      await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'عند التوقيع',50,5000,'signing'),($1,$2,2,'عند التسليم',50,5000,'handover')", [org, c.rows[0].id]);
      return c.rows[0];
    });
    contract = r.id;
    expect(r.number).toBe(`C-${year}-001`);
  });

  it("one active contract per quote", async () => {
    await expectDenied(
      as({ userId: owner }, (q) =>
        q("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'interior',current_date,5,1)", [org, quote, client]),
      ),
    );
  });

  it("staff can't mark a contract accepted — only the client can", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set status = 'accepted' where id = $1", [contract])), /only the client/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set accepted_name = 'x' where id = $1", [contract])), /only the client/);
  });

  it("is isolated between organizations and read-only for viewers", async () => {
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.contracts) + (select count(*)::int from public.contract_payments) as n"));
    expect(b.rows[0].n).toBe(0);
    await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":["quotes.view"],"deny":[]}' where user_id = $1`, [viewer]));
    const v = await as({ userId: viewer }, (q) => q("update public.contracts set notes = 'x' returning id"));
    expect(v.rowCount).toBe(0);
    await expectDenied(
      as({ userId: ownerB }, (q) => q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount) values ($1,$2,9,'x',1,1)", [orgB, contract])),
      /another organization/,
    );
  });
});

describe("client page (portal)", () => {
  it("stores only the token hash", async () => {
    await as({ userId: owner }, (q) =>
      q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]),
    );
    await expectDenied(
      as({ userId: owner }, (q) => q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,'plain-token', now())", [org, contract])),
    );
  });

  it("can't be read by anon or signed-in users directly — only via the server", async () => {
    await expectDenied(as("anon", (q) => q("select public.portal_view($1,$2)", [`C-${year}-001`, TOKEN])));
    await expectDenied(as({ userId: owner }, (q) => q("select public.portal_view($1,$2)", [`C-${year}-001`, TOKEN])));
    await expectDenied(as("anon", (q) => q("select * from public.client_portal_links")));
  });

  it("shows the contract with the right token, nothing with a wrong one or wrong number", async () => {
    const ok = await as("service_role", (q) => q<{ v: Record<string, any> }>("select public.portal_view($1,$2) as v", [`C-${year}-001`, TOKEN]));
    expect(ok.rows[0].v.contract.number).toBe(`C-${year}-001`);
    expect(ok.rows[0].v.payments).toHaveLength(2);
    expect(ok.rows[0].v.quote.client_view.total).toBe(10000);
    const bad = await as("service_role", (q) => q("select public.portal_view($1,$2) as v", [`C-${year}-001`, TOKEN + "y"]));
    expect(bad.rows[0].v).toBeNull();
    const other = await as("service_role", (q) => q("select public.portal_view($1,$2) as v", [`C-${year}-999`, TOKEN]));
    expect(other.rows[0].v).toBeNull();
  });

  it("client accepts once: name, IP and device stored; quote becomes accepted", async () => {
    const r = await as("service_role", (q) =>
      q("select public.portal_accept($1,$2,'محمد العتيبي',null,'1.2.3.4','Safari iPad') as ok", [`C-${year}-001`, TOKEN]),
    );
    expect(r.rows[0].ok).toBe(true);
    const again = await as("service_role", (q) => q("select public.portal_accept($1,$2,'x y',null,'1.2.3.4','x') as ok", [`C-${year}-001`, TOKEN]));
    expect(again.rows[0].ok).toBe(false);
    const c = await as({ userId: owner }, (q) => q("select status, accepted_name, accepted_ip from public.contracts where id = $1", [contract]));
    expect(c.rows[0]).toEqual({ status: "accepted", accepted_name: "محمد العتيبي", accepted_ip: "1.2.3.4" });
    const qs = await as({ userId: owner }, (q) => q("select status from public.quotes where id = $1", [quote]));
    expect(qs.rows[0].status).toBe("accepted");
  });

  it("an accepted contract can't be changed", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set total = 1 where id = $1", [contract])), /cannot change/);
  });

  it("revoked or expired links stop working", async () => {
    await as({ userId: owner }, (q) => q("update public.client_portal_links set revoked_at = now() where contract_id = $1", [contract]));
    const r = await as("service_role", (q) => q("select public.portal_view($1,$2) as v", [`C-${year}-001`, TOKEN]));
    expect(r.rows[0].v).toBeNull();
  });

  it("rejects a malformed signature", async () => {
    const T2 = "tok2_" + "z".repeat(40);
    await as({ userId: owner }, async (q) => {
      const q2 = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'gypsum','issued') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, q2]);
      const c2 = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,3,1,'sent') returning id", [org, q2, client])).rows[0].id;
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 day')", [org, c2, hash(T2)]);
    });
    await expectDenied(as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد','javascript:alert(1)','1.1.1.1','x')", [`C-${year}-002`, T2])), /invalid signature/);
  });
});
