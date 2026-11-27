import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/** Subcontractor account (owner, Nov 2026): numbers, payment vouchers, his own page by link + token. */
let owner: string, fin: string, viewer: string, org: string, client: string, contract: string, sub: string, subNumber: string, agreement: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const token = () => randomBytes(12).toString("base64url");

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500006001");
  fin = await createUser("966500006002");
  viewer = await createUser("966500006003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org S') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'finance'),($1,$3,'viewer')", [org, fin, viewer]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو فهد','966511116666','1099999999') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',5000,5000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,5000,'sent') returning id", [org, quote, client])).rows[0].id;
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,5000,'custom')", [org, contract]);
  });
  await asAdmin((q) => q("update public.contracts set status = 'accepted', accepted_at = now() where id = $1", [contract]));
  const s = await as({ userId: owner }, async (q) => (await q<{ id: string; number: string }>("insert into public.subcontractors (organization_id, name, phone) values ($1,'مقاول الجبس','966500009191') returning id, number", [org])).rows[0]);
  sub = s.id;
  subNumber = s.number;
  agreement = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule, auto_progress) values ($1,$2,$3,'تركيب أسقف','per_m2',20,100,'weekly',false) returning id", [org, sub, contract])).rows[0].id);
});
afterAll(closePool);

describe("numbers", () => {
  it("subcontractors are SC-, payments SP- (vouchers), given by the database only", async () => {
    expect(subNumber).toMatch(/^SC-\d{4}-\d{3}$/);
    await as({ userId: owner }, (q) => q("insert into public.subcontractor_work (organization_id, agreement_id, quantity_m2, amount) values ($1,$2,50,0)", [org, agreement]));
    const p = await as({ userId: fin }, async (q) => (await q<{ number: string }>("insert into public.subcontractor_payments (organization_id, agreement_id, paid_on, amount, method) values ($1,$2,current_date,600,'transfer') returning number", [org, agreement])).rows[0].number);
    expect(p).toMatch(/^SP-\d{4}-\d{3}$/);
    await expectDenied(as({ userId: fin }, (q) => q("insert into public.subcontractor_payments (organization_id, agreement_id, paid_on, amount, method, number) values ($1,$2,current_date,1,'transfer','SP-2026-999')", [org, agreement])), /given by the database/);
  });
});

describe("his page", () => {
  it("only purchases.manage issues a link; a new link revokes the old one", async () => {
    await expectDenied(as({ userId: viewer }, (q) => q("select public.issue_subcontractor_link($1,$2)", [sub, hash(token())])), /not allowed/);
    const t1 = token();
    await as({ userId: owner }, (q) => q("select public.issue_subcontractor_link($1,$2)", [sub, hash(t1)]));
    const t2 = token();
    await as({ userId: owner }, (q) => q("select public.issue_subcontractor_link($1,$2)", [sub, hash(t2)]));
    const view = (t: string) => as("service_role", async (q) => (await q<{ v: unknown }>("select public.subcontractor_portal_view($1,$2) as v", [subNumber, t])).rows[0].v);
    expect(await view(t1)).toBeNull();
    const v = (await view(t2)) as { subcontractor: { name: string }; agreements: { client: string; scope: string; work: unknown[]; payments: { number: string; amount: number }[] }[] };
    expect(v.subcontractor.name).toBe("مقاول الجبس");
    expect(v.agreements[0].client).toBe("أبو فهد");
    expect(v.agreements[0].payments.map((p) => Number(p.amount))).toEqual([600]);
    // no client phone / id, no prices to the client
    expect(JSON.stringify(v)).not.toContain("966511116666");
    expect(JSON.stringify(v)).not.toContain("1099999999");
    // his voucher opens under his link, not by number alone or another token
    const pv = v.agreements[0].payments[0].number;
    const voucher = (t: string, n: string) => as("service_role", async (q) => (await q<{ v: unknown }>("select public.subcontractor_portal_voucher($1,$2,$3) as v", [subNumber, t, n])).rows[0].v);
    expect(await voucher(t2, pv)).not.toBeNull();
    expect(await voucher(t1, pv)).toBeNull();
    // users can't call the page functions
    await expectDenied(as({ userId: owner }, (q) => q("select public.subcontractor_portal_view($1,$2)", [subNumber, t2])));
    // deactivating him closes the page
    await as({ userId: owner }, (q) => q("update public.subcontractors set is_active = false where id = $1", [sub]));
    expect(await view(t2)).toBeNull();
    await as({ userId: owner }, (q) => q("update public.subcontractors set is_active = true where id = $1", [sub]));
  });
});
