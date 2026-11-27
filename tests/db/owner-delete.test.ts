import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * Deleting clients, surveys and quotes (owner, Nov 2026): only the organization's owner, only
 * through public.delete_client / delete_survey / delete_quote, and never a financial or legal
 * record — a quote with any contract (even cancelled) or accepted by the client on his page stays,
 * and so does its client.
 */
let owner: string, sup: string, other: string, org: string, orgB: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const PAY = JSON.stringify([{ label: "عند التوقيع", percent: 100, due_event: "signing" }]);

async function newClient(q: Q, o = org): Promise<{ id: string; number: string }> {
  return (await q<{ id: string; number: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'عميل للحذف','966511110000','1000000008') returning id, number", [o])).rows[0];
}
async function newSurvey(q: Q, client: string, o = org): Promise<{ id: string; number: string }> {
  const s = (await q<{ id: string; number: string }>("insert into public.surveys (organization_id, client_id, mode) values ($1,$2,'rooms') returning id, number", [o, client])).rows[0];
  await q("insert into public.survey_rooms (organization_id, survey_id, name, length_m, width_m, height_m) values ($1,$2,'المجلس',5,4,3)", [o, s.id]);
  return s;
}
async function newQuote(q: Q, client: string, survey: string | null = null, o = org): Promise<{ id: string; number: string }> {
  const r = (await q<{ id: string; number: string }>("insert into public.quotes (organization_id, client_id, survey_id, service) values ($1,$2,$3,'interior') returning id, number", [o, client, survey])).rows[0];
  await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{\"workTypes\":[]}',1000,0,0,1000)", [o, r.id]);
  return r;
}
const issue = (q: Q, id: string) => q("select public.issue_quote($1, current_date + 7)", [id]);
const del = (u: string, kind: "client" | "survey" | "quote", id: string) => as({ userId: u }, (q) => q(`select public.delete_${kind}($1)`, [id]));
const exists = (table: string, id: string) => asAdmin((q) => q(`select 1 from public.${table} where id = $1`, [id])).then((r) => r.rowCount === 1);
const view = (n: string, t: string) => as("service_role", (q) => q<{ v: unknown }>("select public.portal_view($1,$2) as v", [n, t])).then((r) => r.rows[0].v);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009201");
  sup = await createUser("966500009202");
  other = await createUser("966500009203");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: other }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, (q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, sup]));
});
afterAll(closePool);

describe("only the owner deletes", () => {
  it("a supervisor (clients.manage + quotes.manage) can't delete — not through the functions, not directly", async () => {
    const { c, s, qt } = await as({ userId: sup }, async (q) => {
      const c = await newClient(q);
      const s = await newSurvey(q, c.id);
      const qt = await newQuote(q, c.id, s.id);
      return { c, s, qt };
    });
    await expectDenied(del(sup, "quote", qt.id), /not allowed/);
    await expectDenied(del(sup, "survey", s.id), /not allowed/);
    await expectDenied(del(sup, "client", c.id), /not allowed/);
    // direct deletes: no privilege at all
    await expectDenied(as({ userId: sup }, (q) => q("delete from public.quotes where id = $1", [qt.id])), /permission denied/);
    await expectDenied(as({ userId: sup }, (q) => q("delete from public.surveys where id = $1", [s.id])), /permission denied/);
    await expectDenied(as({ userId: sup }, (q) => q("delete from public.clients where id = $1", [c.id])), /permission denied/);
    // even the owner deletes only through the functions
    await expectDenied(as({ userId: owner }, (q) => q("delete from public.clients where id = $1", [c.id])), /permission denied/);
    expect(await exists("clients", c.id)).toBe(true);
    expect(await exists("surveys", s.id)).toBe(true);
    expect(await exists("quotes", qt.id)).toBe(true);
    // rooms stay part of everyday survey editing
    await as({ userId: sup }, (q) => q("delete from public.survey_rooms where survey_id = $1", [s.id]));
    expect((await asAdmin((q) => q("select 1 from public.survey_rooms where survey_id = $1", [s.id]))).rowCount).toBe(0);
  });

  it("another organization's owner can't delete ours, and ours can't delete theirs", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    await expectDenied(del(other, "client", c.id), /not allowed/);
    const cb = await as({ userId: other }, (q) => newClient(q, orgB));
    await expectDenied(del(owner, "client", cb.id), /not allowed/);
    expect(await exists("clients", c.id)).toBe(true);
    expect(await exists("clients", cb.id)).toBe(true);
    // an unknown id answers the same (nothing leaks)
    await expectDenied(del(owner, "quote", "00000000-0000-0000-0000-000000000000"), /not allowed/);
  });

  it("anonymous callers can't call them", async () => {
    for (const k of ["client", "survey", "quote"]) {
      await expectDenied(as("anon", (q) => q(`select public.delete_${k}('00000000-0000-0000-0000-000000000000')`)), /permission denied/);
    }
  });
});

describe("deleting a quote", () => {
  it("deletes its versions, costs, approvals, their notifications and its client-page link (the token stops working)", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q, c.id);
      await issue(q, x.id);
      await asServer(q, "insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, purchase_list) select id, organization_id, 500, 525, 20, '[]', '[]' from public.quote_versions where quote_id = $1", [x.id]);
      await q("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_discount','quote',$2,'{\"version\":1}')", [org, x.id]);
      await q("select public.issue_quote_link($1,$2)", [x.id, hash("tok_delete_quote_1")]);
      return x;
    });
    expect(await view(qt.number, "tok_delete_quote_1")).not.toBeNull();
    const notes = await asAdmin((q) => q("select count(*)::int as n from public.notifications n join public.approvals a on n.params ->> 'approval_id' = a.id::text where a.entity_id = $1", [qt.id]));
    expect(notes.rows[0].n).toBeGreaterThan(0);

    await del(owner, "quote", qt.id);
    expect(await exists("quotes", qt.id)).toBe(false);
    const left = await asAdmin((q) => q<{ v: number; c: number; a: number; l: number; n: number }>(
      `select (select count(*)::int from public.quote_versions where quote_id = $1) as v,
              (select count(*)::int from public.quote_version_costs k join public.quote_versions v on v.id = k.quote_version_id where v.quote_id = $1) as c,
              (select count(*)::int from public.approvals where entity = 'quote' and entity_id = $1) as a,
              (select count(*)::int from public.client_portal_links where quote_id = $1 or token_hash = $2) as l,
              (select count(*)::int from public.notifications where link = '/quotations/' || $3) as n`, [qt.id, hash("tok_delete_quote_1"), qt.number]));
    expect(left.rows[0]).toEqual({ v: 0, c: 0, a: 0, l: 0, n: 0 });
    expect(await view(qt.number, "tok_delete_quote_1")).toBeNull();
    expect(await exists("clients", c.id)).toBe(true);
  });

  it("is recorded in the audit log under the owner, with the old row", async () => {
    const qt = await as({ userId: owner }, async (q) => newQuote(q, (await newClient(q)).id));
    await del(owner, "quote", qt.id);
    const a = await asAdmin((q) => q<{ actor_id: string; before: { number: string } }>("select actor_id, before from public.audit_log where table_name = 'quotes' and action = 'delete' and record_id = $1", [qt.id]));
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(owner);
    expect(a.rows[0].before.number).toBe(qt.number);
    const v = await asAdmin((q) => q("select actor_id from public.audit_log where table_name = 'quote_versions' and action = 'delete' and before ->> 'quote_id' = $1", [qt.id]));
    expect(v.rows.map((r) => r.actor_id)).toEqual([owner]);
  });

  it("refuses a quote with a contract — sent, draft or even cancelled", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const qt = await as({ userId: owner }, async (q) => {
      const x = await newQuote(q, c.id);
      await issue(q, x.id);
      return x;
    });
    const k = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await expectDenied(del(owner, "quote", qt.id), /quote has a contract/);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'cancelled' where id = $1", [k.id]));
    await expectDenied(del(owner, "quote", qt.id), /quote has a contract/);
    expect(await exists("quotes", qt.id)).toBe(true);
  });

  it("refuses a quote the client accepted on his page; a rejected one can go", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const [qa, qr] = await as({ userId: owner }, async (q) => {
      const a = await newQuote(q, c.id);
      const r = await newQuote(q, c.id);
      for (const x of [a, r]) await issue(q, x.id);
      await q("select public.issue_quote_link($1,$2)", [a.id, hash("tok_delete_quote_a")]);
      await q("select public.issue_quote_link($1,$2)", [r.id, hash("tok_delete_quote_r")]);
      return [a, r];
    });
    await as("service_role", (q) => q("select public.portal_accept_quote($1,$2,'أبو فهد','1.2.3.4','iPhone',1)", [qa.number, "tok_delete_quote_a"]));
    await as("service_role", (q) => q("select public.portal_reject_quote($1,$2,null,'1.2.3.4','iPhone')", [qr.number, "tok_delete_quote_r"]));
    await expectDenied(del(owner, "quote", qa.id), /quote accepted by the client/);
    await del(owner, "quote", qr.id);
    expect(await exists("quotes", qa.id)).toBe(true);
    expect(await exists("quotes", qr.id)).toBe(false);
  });
});

describe("deleting a survey", () => {
  it("deletes it with its rooms, audited under the owner", async () => {
    const s = await as({ userId: owner }, async (q) => newSurvey(q, (await newClient(q)).id));
    await del(owner, "survey", s.id);
    expect(await exists("surveys", s.id)).toBe(false);
    const r = await asAdmin((q) => q("select actor_id from public.audit_log where table_name in ('surveys', 'survey_rooms') and action = 'delete' and (record_id = $1 or before ->> 'survey_id' = $1)", [s.id]));
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((x) => x.actor_id === owner)).toBe(true);
  });

  it("refuses while a quote is built on it (delete the quote first)", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const { s, qt } = await as({ userId: owner }, async (q) => {
      const s = await newSurvey(q, c.id);
      return { s, qt: await newQuote(q, c.id, s.id) };
    });
    await expectDenied(del(owner, "survey", s.id), /survey has quotes/);
    await del(owner, "quote", qt.id);
    await del(owner, "survey", s.id);
    expect(await exists("surveys", s.id)).toBe(false);
  });
});

describe("deleting a client", () => {
  it("deletes his surveys (with rooms) and quotes (with versions and links), audited", async () => {
    const { c, s, qt } = await as({ userId: owner }, async (q) => {
      const c = await newClient(q);
      const s = await newSurvey(q, c.id);
      const qt = await newQuote(q, c.id, s.id);
      await issue(q, qt.id);
      await q("select public.issue_quote_link($1,$2)", [qt.id, hash("tok_delete_client")]);
      return { c, s, qt };
    });
    await del(owner, "client", c.id);
    for (const [t, id] of [["clients", c.id], ["surveys", s.id], ["quotes", qt.id]] as const) expect(await exists(t, id)).toBe(false);
    expect(await view(qt.number, "tok_delete_client")).toBeNull();
    const a = await asAdmin((q) => q<{ table_name: string; actor_id: string }>("select table_name, actor_id from public.audit_log where action = 'delete' and record_id in ($1,$2,$3)", [c.id, s.id, qt.id]));
    expect(a.rows.map((r) => r.table_name).sort()).toEqual(["clients", "quotes", "surveys"]);
    expect(a.rows.every((r) => r.actor_id === owner)).toBe(true);
  });

  it("refuses a client with any contract (even cancelled) — nothing of his is deleted", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const { s, spare } = await as({ userId: owner }, async (q) => {
      const s = await newSurvey(q, c.id);
      const x = await newQuote(q, c.id);
      await issue(q, x.id);
      const k = await q<{ r: { id: string } }>("select public.create_contract($1, current_date, 10, 6, null, $2::jsonb) as r", [x.id, PAY]);
      await q("update public.contracts set status = 'cancelled' where id = $1", [k.rows[0].r.id]);
      return { s, spare: await newQuote(q, c.id) };
    });
    await expectDenied(del(owner, "client", c.id), /client has contracts/);
    expect(await exists("clients", c.id)).toBe(true);
    expect(await exists("surveys", s.id)).toBe(true);
    expect(await exists("quotes", spare.id)).toBe(true);
  });

  it("refuses a client one of whose quotes can't be deleted (accepted on his page)", async () => {
    const c = await as({ userId: owner }, (q) => newClient(q));
    const { qa, spare } = await as({ userId: owner }, async (q) => {
      const qa = await newQuote(q, c.id);
      await issue(q, qa.id);
      await q("select public.issue_quote_link($1,$2)", [qa.id, hash("tok_delete_client_acc")]);
      return { qa, spare: await newQuote(q, c.id) };
    });
    await as("service_role", (q) => q("select public.portal_accept_quote($1,$2,'أبو فهد','1.2.3.4','iPhone',1)", [qa.number, "tok_delete_client_acc"]));
    await expectDenied(del(owner, "client", c.id), /client has an accepted quote/);
    expect(await exists("quotes", spare.id)).toBe(true);
    expect(await view(qa.number, "tok_delete_client_acc")).not.toBeNull();
  });
});
