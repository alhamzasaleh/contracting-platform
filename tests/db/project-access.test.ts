import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, sup: string, sup2: string, org: string, c1: string, c2: string, m1: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500005001");
  sup = await createUser("966500005002");
  sup2 = await createUser("966500005003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    m1 = (await q<{ id: string }>("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor') returning id", [org, sup])).rows[0].id;
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, sup2]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'gypsum','issued') returning id", [org, client])).rows[0].id;
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
      ids.push((await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum',current_date,5,1000) returning id", [org, quote, client])).rows[0].id);
    }
    [c1, c2] = ids;
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'a',100,1000,'signing'),($1,$3,1,'b',100,1000,'signing')", [org, c1, c2]);
  });
});
afterAll(closePool);

const contracts = (u: string) => as({ userId: u }, (q) => q<{ id: string }>("select id from public.contracts order by created_at")).then((r) => r.rows.map((x) => x.id));
const payments = (u: string) => as({ userId: u }, (q) => q<{ contract_id: string }>("select contract_id from public.contract_payments")).then((r) => r.rows.map((x) => x.contract_id));

describe("per-project access", () => {
  it("scope 'all' (the default) sees every project", async () => {
    expect(await contracts(sup)).toEqual([c1, c2]);
  });

  it("scope 'assigned' sees only assigned projects and their payments", async () => {
    await as({ userId: owner }, (q) => q("update public.memberships set project_scope = 'assigned' where id = $1", [m1]));
    expect(await contracts(sup)).toEqual([]);
    await as({ userId: owner }, (q) => q("insert into public.project_members (organization_id, contract_id, user_id) values ($1,$2,$3)", [org, c1, sup]));
    expect(await contracts(sup)).toEqual([c1]);
    expect(await payments(sup)).toEqual([c1]);
    expect((await contracts(owner)).length).toBe(2);
    // can't touch the other project either
    const upd = await as({ userId: sup }, (q) => q("update public.contracts set notes = 'x' where id = $1 returning id", [c2]));
    expect(upd.rows).toHaveLength(0);
  });

  it("only members.manage assigns; a supervisor can't assign themselves", async () => {
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.project_members (organization_id, contract_id, user_id) values ($1,$2,$3)", [org, c2, sup])));
    await as({ userId: sup }, (q) => q("update public.memberships set project_scope = 'all' where id = $1", [m1])).catch(() => undefined);
    const scope = await asAdmin((q) => q<{ project_scope: string }>("select project_scope from public.memberships where id = $1", [m1]));
    expect(scope.rows[0].project_scope).toBe("assigned");
  });

  it("project notifications reach only members who can see the project", async () => {
    await asAdmin((q) => q("select private.notify($1,'projects.view','project_delay','{}'::jsonb,'/contracts/' || (select number from public.contracts where id = $2),'pa1')", [org, c2]));
    const got = await asAdmin((q) => q<{ user_id: string }>("select user_id from public.notifications where dedupe_key = 'pa1'"));
    const users = got.rows.map((r) => r.user_id);
    expect(users).toContain(owner);
    expect(users).toContain(sup2);
    expect(users).not.toContain(sup);
  });
});
