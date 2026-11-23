import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, finance: string, ownerB: string;
let org: string, orgB: string, contract: string, pay1: string, pay2: string;
const TOKEN = "tok_" + "q".repeat(40);
const KEY = "qoyodTestKey_1234ABCD";
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const jobs = () => asAdmin((q) => q<{ kind: string; ref: string; amount: string | null; status: string }>("select kind, ref, amount, status from public.qoyod_sync_jobs where organization_id = $1 order by created_at, kind", [org])).then((r) => r.rows);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001501");
  supervisor = await createUser("966500001502");
  finance = await createUser("966500001503");
  ownerB = await createUser("966500001504");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'finance')", [org, supervisor, finance]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'gypsum','issued') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,10000,'sent') returning id", [org, quote, client])).rows[0].id;
    const p = await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'توقيع',60,6000,'signing'),($1,$2,2,'تسليم',40,4000,'handover') returning id", [org, contract]);
    [pay1, pay2] = p.rows.map((r) => r.id);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [`C-${year}-001`, TOKEN]));
});
afterAll(closePool);

describe("qoyod", () => {
  it("the key is write-only: settings managers set it, nobody reads it back but the server", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("select public.qoyod_set_key($1,$2)", [org, KEY])));
    await expectDenied(as({ userId: ownerB }, (q) => q("select public.qoyod_set_key($1,$2)", [org, KEY])));
    await as({ userId: owner }, (q) => q("select public.qoyod_set_key($1,$2)", [org, KEY]));
    const s = await as({ userId: owner }, (q) => q<{ key_last4: string }>("select key_last4 from public.qoyod_settings where organization_id = $1", [org]));
    expect(s.rows[0].key_last4).toBe("ABCD");
    await expectDenied(as({ userId: owner }, (q) => q("select public.qoyod_api_key($1)", [org])));
    await expectDenied(as({ userId: owner }, (q) => q("select * from private.qoyod_keys")));
    const k = await as("service_role", (q) => q<{ k: string }>("select public.qoyod_api_key($1) as k", [org]));
    expect(k.rows[0].k).toBe(KEY);
    await expectDenied(as({ userId: owner }, (q) => q("select public.qoyod_set_key($1,'bad key with spaces')", [org])));
  });

  it("nothing is queued while sending is off", async () => {
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 1000, 'transfer', null)", [pay1]));
    expect(await jobs()).toEqual([]);
  });

  it("when on: a requested payment becomes an invoice, money received becomes a receipt (once)", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.qoyod_settings set enabled = true where organization_id = $1 returning 1", [org]).then((r) => { if (!r.rowCount) throw Object.assign(new Error("denied"), { code: "42501" }); })));
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set enabled = true, inventory_id = 1, receive_account_id = 7 where organization_id = $1", [org]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.qoyod_settings set key_last4 = 'XXXX' where organization_id = $1", [org])));
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 5000, 'transfer', null)", [pay1]));
    await as({ userId: owner }, (q) => q("update public.contract_payments set status = 'requested' where id = $1", [pay2]).catch(() => null));
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 4000, 'cash', null)", [pay2]));
    const list = await jobs();
    expect(list.filter((j) => j.kind === "invoice").map((j) => j.ref).sort()).toEqual([`cp:${pay1}`, `cp:${pay2}`].sort());
    expect(list.filter((j) => j.kind === "invoice_payment").map((j) => [j.ref, Number(j.amount)])).toEqual(
      expect.arrayContaining([[`cp:${pay1}:6000.00`, 5000], [`cp:${pay2}:4000.00`, 4000]]),
    );
  });

  it("only finance / settings see the log; nobody writes jobs directly; the worker is server-only", async () => {
    expect((await as({ userId: supervisor }, (q) => q("select * from public.qoyod_sync_jobs"))).rowCount).toBe(0);
    expect((await as({ userId: ownerB }, (q) => q("select * from public.qoyod_sync_jobs"))).rowCount).toBe(0);
    expect((await as({ userId: finance }, (q) => q("select * from public.qoyod_sync_jobs"))).rowCount).toBeGreaterThan(0);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref) values ($1,'invoice','contract_payment',$2,'x')", [org, pay1])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.qoyod_sync_jobs set status = 'done'")));
    await expectDenied(as({ userId: owner }, (q) => q("select * from public.qoyod_claim_jobs(5)")));
    const claimed = await as("service_role", (q) => q<{ kind: string }>("select kind from public.qoyod_claim_jobs(50)"));
    expect(claimed.rows[0].kind).toBe("invoice"); // invoices before their payments
  });

  it("failed jobs are retried by finance, not by others", async () => {
    await asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'failed' where organization_id = $1", [org]));
    await expectDenied(as({ userId: supervisor }, (q) => q("select public.qoyod_retry($1, null)", [org])));
    const r = await as({ userId: finance }, (q) => q<{ n: number }>("select public.qoyod_retry($1, null) as n", [org]));
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it("the client page lists only finished invoices, and only with the right token", async () => {
    await asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'done', qoyod_id = 501 where organization_id = $1 and ref = $2", [org, `cp:${pay1}`]));
    const ok = await as("service_role", (q) => q<{ r: { org: string; items: { key: string; qoyod_id: number }[] } }>("select public.portal_invoices($1,$2) as r", [`C-${year}-001`, TOKEN]));
    expect(ok.rows[0].r.items).toEqual([{ key: "p1", qoyod_id: 501 }]);
    expect(ok.rows[0].r.org).toBe(org);
    const bad = await as("service_role", (q) => q<{ r: unknown }>("select public.portal_invoices($1,$2) as r", [`C-${year}-001`, "tok_" + "x".repeat(40)]));
    expect(bad.rows[0].r).toBeNull();
    await expectDenied(as("anon", (q) => q("select public.portal_invoices($1,$2)", [`C-${year}-001`, TOKEN])));
  });

  it("backfill queues older records once, for settings managers only", async () => {
    await asAdmin((q) => q("delete from public.qoyod_sync_jobs where organization_id = $1", [org]));
    await expectDenied(as({ userId: finance }, (q) => q("select public.qoyod_backfill($1, current_date - 30)", [org])));
    const n1 = await as({ userId: owner }, (q) => q<{ n: number }>("select public.qoyod_backfill($1, current_date - 30) as n", [org]));
    expect(n1.rows[0].n).toBeGreaterThanOrEqual(3);
    const n2 = await as({ userId: owner }, (q) => q<{ n: number }>("select public.qoyod_backfill($1, current_date - 30) as n", [org]));
    expect(n2.rows[0].n).toBe(0);
    expect(orgB).toBeTruthy();
  });
});
