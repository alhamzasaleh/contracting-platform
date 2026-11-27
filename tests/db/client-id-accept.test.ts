import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * The client's ID number on his page (owner, Nov 2026): accepting the quote or the contract
 * asks for it once when the client's record has none, and stores it there; a number staff
 * already entered is never asked for nor changed.
 */
let owner: string, org: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const tok = (c: string) => `tok_${c.repeat(20)}`;
const PAY = JSON.stringify([{ label: "عند التوقيع", percent: 100, due_event: "signing" }]);
const svc = <T extends Record<string, unknown>>(sql: string, params: unknown[]) => as("service_role", (q) => q<T>(sql, params));
const idOf = (client: string) => asAdmin((q) => q<{ id_number: string | null }>("select id_number from public.clients where id = $1", [client])).then((r) => r.rows[0].id_number);

async function quoteFor(idNumber: string | null, t: string) {
  return as({ userId: owner }, async (q: Q) => {
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو فهد','966511119999',$2) returning id", [org, idNumber])).rows[0].id;
    const qt = (await q<{ id: string; number: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'interior') returning id, number", [org, client])).rows[0];
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{\"workTypes\":[]}',1000,0,0,1000)", [org, qt.id]);
    await q("select public.issue_quote($1, current_date + 7)", [qt.id]);
    await q("select public.issue_quote_link($1,$2)", [qt.id, hash(t)]);
    return { client, ...qt };
  });
}
const acceptQuote = (n: string, t: string, id: string | null) =>
  svc<{ ok: boolean }>("select public.portal_accept_quote($1,$2,'أبو فهد','1.2.3.4','iPhone',1,$3) as ok", [n, t, id]).then((r) => r.rows[0].ok);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009201");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
});
afterAll(closePool);

describe("accepting the quote", () => {
  it("asks for the ID when the client has none, then stores it", async () => {
    const qt = await quoteFor(null, tok("a"));
    await expectDenied(acceptQuote(qt.number, tok("a"), null), /id required/);
    await expectDenied(acceptQuote(qt.number, tok("a"), "12345"), /id required/);
    expect(await idOf(qt.client)).toBeNull();
    expect(await acceptQuote(qt.number, tok("a"), "1000000008")).toBe(true);
    expect(await idOf(qt.client)).toBe("1000000008");
    const a = await asAdmin((q) => q("select 1 from public.audit_log where action = 'client_id_number' and record_id = $1", [qt.client]));
    expect(a.rowCount).toBe(1);
  });

  it("never asks for nor changes a number staff already entered", async () => {
    const qt = await quoteFor("2000000006", tok("b"));
    expect(await acceptQuote(qt.number, tok("b"), null)).toBe(true);
    expect(await idOf(qt.client)).toBe("2000000006");
    const qt2 = await quoteFor("2000000006", tok("c"));
    expect(await acceptQuote(qt2.number, tok("c"), "1000000008")).toBe(true);
    expect(await idOf(qt2.client)).toBe("2000000006");
  });
});

describe("accepting the contract", () => {
  it("asks for the ID when still missing (a contract sent without the quote accepted on the page)", async () => {
    const qt = await quoteFor(null, tok("d"));
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date + 5, 20, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'sent' where id = $1", [c.id]));
    const accept = (id: string | null) => svc<{ ok: boolean }>("select public.portal_accept($1,$2,'أبو فهد',null,'1.1.1.1','x',null,$3) as ok", [qt.number, tok("d"), id]).then((r) => r.rows[0].ok);
    await expectDenied(accept(null), /id required/);
    const st = await asAdmin((q) => q<{ status: string }>("select status from public.contracts where id = $1", [c.id]));
    expect(st.rows[0].status).toBe("sent");
    expect(await accept("1000000008")).toBe(true);
    expect(await idOf(qt.client)).toBe("1000000008");
    // the signing payment's invoice (issued in the same acceptance) names him by it
    const inv = await asAdmin((q) => q<{ id: string | null }>("select buyer ->> 'id_number' as id from public.invoices where contract_id = $1", [c.id]));
    expect(inv.rows.map((r) => r.id)).toEqual(["1000000008"]);
  });

  it("after the quote was accepted with it, the contract doesn't ask again nor change it", async () => {
    const qt = await quoteFor(null, tok("e"));
    expect(await acceptQuote(qt.number, tok("e"), "1000000008")).toBe(true);
    const v = await svc<{ v: { client: { id_number: string | null } } }>("select public.portal_view($1,$2) as v", [qt.number, tok("e")]);
    expect(v.rows[0].v.client.id_number).toBe("1000000008");
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date + 5, 20, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'sent' where id = $1", [c.id]));
    expect((await svc<{ ok: boolean }>("select public.portal_accept($1,$2,'أبو فهد',null,'1.1.1.1','x',null,'2000000006') as ok", [qt.number, tok("e")])).rows[0].ok).toBe(true);
    expect(await idOf(qt.client)).toBe("1000000008");
  });

  it("the signed contract keeps the number it was signed with; users can't write it", async () => {
    const qt = await quoteFor("1000000008", tok("f"));
    const c = await as({ userId: owner }, (q) => q<{ r: { id: string } }>("select public.create_contract($1, current_date + 5, 20, 6, null, $2::jsonb) as r", [qt.id, PAY])).then((r) => r.rows[0].r);
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set client_id_number = '2000000006' where id = $1", [c.id])), /not allowed/);
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'sent' where id = $1", [c.id]));
    await svc("select public.portal_accept($1,$2,'أبو فهد',null,'1.1.1.1','x')", [qt.number, tok("f")]);
    // staff correct the client's record afterwards: the signed contract still shows the signed number
    await as({ userId: owner }, (q) => q("update public.clients set id_number = '2000000006' where id = $1", [qt.client]));
    const row = await asAdmin((q) => q<{ client_id_number: string }>("select client_id_number from public.contracts where id = $1", [c.id]));
    expect(row.rows[0].client_id_number).toBe("1000000008");
    const v = await svc<{ v: { client: { id_number: string } } }>("select public.portal_view($1,$2) as v", [qt.number, tok("f")]);
    expect(v.rows[0].v.client.id_number).toBe("1000000008");
  });

  it("users can't call the client functions", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("select private.portal_take_client_id(gen_random_uuid(), '1000000008')")));
  });
});
