import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, viewer: string, ownerB: string;
let org: string, contract: string, pay1: string;
const TOKEN = "tok_" + "m".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const C = `C-${year}-001`;
const photo = () => `${org}/${contract}/client/${crypto.randomUUID()}.jpg`;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001701");
  supervisor = await createUser("966500001702");
  viewer = await createUser("966500001703");
  ownerB = await createUser("966500001704");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'viewer')", [org, supervisor, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'عميل','966511112222') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',10000,10000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status, warranty_months) values ($1,$2,1,$3,'gypsum',current_date,10,10000,'sent',6) returning id", [org, quote, client])).rows[0].id;
    pay1 = (await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'عند التوقيع',100,10000,'signing') returning id", [org, contract])).rows[0].id;
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '20 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [C, TOKEN]));
});
afterAll(closePool);

describe("receipt message to the client", () => {
  it("a receipt queues a WhatsApp message to the client's phone (server-only outbox)", async () => {
    await as({ userId: owner }, (q) => q("select public.record_client_payment($1, current_date, 2500, 'transfer', null)", [pay1]));
    const m = await asAdmin((q) => q<{ phone: string; kind: string; params: { number: string; amount: number; contract: string } }>("select phone, kind, params from public.client_messages"));
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ phone: "966511112222", kind: "receipt" });
    expect(m.rows[0].params.contract).toBe(C);
    await expectDenied(as({ userId: owner }, (q) => q("select * from public.client_messages")));
  });
});

describe("warranty & maintenance", () => {
  it("no maintenance before the final handover", async () => {
    await expectDenied(as("service_role", (q) => q("select public.portal_add_maintenance($1,$2,'تشقق',$3)", [C, TOKEN, []])));
    const w = await as("service_role", (q) => q<{ w: { active: boolean; warranty_end: string | null } }>("select public.portal_warranty($1,$2) as w", [C, TOKEN]));
    expect(w.rows[0].w.active).toBe(false);
  });

  it("after handover the client opens a request; managers are notified, viewers can read only", async () => {
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() where contract_id = $1", [contract]));
    const w = await as("service_role", (q) => q<{ w: { active: boolean; warranty_end: string } }>("select public.portal_warranty($1,$2) as w", [C, TOKEN]));
    expect(w.rows[0].w.active).toBe(true);
    const link = await asAdmin((q) => q<{ ok: boolean }>("select expires_at >= now() + interval '5 months' as ok from public.client_portal_links where contract_id = $1", [contract]));
    expect(link.rows[0].ok).toBe(true);
    const r = await as("service_role", (q) => q<{ n: string }>("select public.portal_add_maintenance($1,$2,'تشقق بسيط في سقف المجلس',$3) as n", [C, TOKEN, [photo()]]));
    expect(r.rows[0].n).toBe(`MR-${year}-001`);
    await expectDenied(as("service_role", (q) => q("select public.portal_add_maintenance($1,$2,'x',$3)", [C, TOKEN, ["../../etc/passwd"]])));
    const notes = await as({ userId: supervisor }, (q) => q("select 1 from public.notifications where kind = 'maintenance_request'"));
    expect(notes.rowCount).toBe(1);
    expect((await as({ userId: viewer }, (q) => q("select 1 from public.maintenance_requests"))).rowCount).toBe(1);
    await expectDenied(as({ userId: viewer }, (q) => q("update public.maintenance_requests set status = 'in_progress' returning 1").then((x) => { if (!x.rowCount) throw Object.assign(new Error("denied"), { code: "42501" }); })));
    expect((await as({ userId: ownerB }, (q) => q("select 1 from public.maintenance_requests"))).rowCount).toBe(0);
  });

  it("staff can't rewrite what the client wrote; they assign, cost and resolve", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.maintenance_requests set body = 'x'")));
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.maintenance_requests set assigned_to = $1", [ownerB])));
    await as({ userId: supervisor }, (q) => q("update public.maintenance_requests set assigned_to = $1, status = 'in_progress', cost = 150, covered = true", [supervisor]));
    await as({ userId: supervisor }, (q) => q("update public.maintenance_requests set status = 'resolved', reply = 'تمت المعالجة وإعادة الدهان'"));
    const row = await asAdmin((q) => q<{ resolved_at: string | null }>("select resolved_at from public.maintenance_requests"));
    expect(row.rows[0].resolved_at).not.toBeNull();
    const msg = await asAdmin((q) => q("select 1 from public.client_messages where kind = 'maintenance_done'"));
    expect(msg.rowCount).toBe(1);
  });

  it("only the client confirms the fix (with the page token)", async () => {
    const id = (await asAdmin((q) => q<{ id: string }>("select id from public.maintenance_requests"))).rows[0].id;
    const bad = await as("service_role", (q) => q<{ ok: boolean }>("select public.portal_confirm_maintenance($1,$2,$3) as ok", [C, "tok_" + "x".repeat(40), id]));
    expect(bad.rows[0].ok).toBe(false);
    const ok = await as("service_role", (q) => q<{ ok: boolean }>("select public.portal_confirm_maintenance($1,$2,$3) as ok", [C, TOKEN, id]));
    expect(ok.rows[0].ok).toBe(true);
    const row = await asAdmin((q) => q<{ status: string; client_confirmed_at: string | null }>("select status, client_confirmed_at from public.maintenance_requests"));
    expect(row.rows[0]).toMatchObject({ status: "closed" });
    expect(row.rows[0].client_confirmed_at).not.toBeNull();
    await expectDenied(as("anon", (q) => q("select public.portal_warranty($1,$2)", [C, TOKEN])));
  });

  it("after the warranty ends the client can't open new requests", async () => {
    await asAdmin((q) => q("update public.project_stages set confirmed_at = now() - interval '7 months' where contract_id = $1", [contract]));
    await expectDenied(as("service_role", (q) => q("select public.portal_add_maintenance($1,$2,'تسريب',$3)", [C, TOKEN, []])));
    const list = await as({ userId: owner }, (q) => q<{ number: string }>("select number from public.contract_warranties($1)", [org]));
    expect(list.rows.map((r) => r.number)).toEqual([C]);
  });
});
