import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, finance: string, ownerB: string;
let org: string, contract: string, pay1: string, pay2: string;
const TOKEN = "tok_" + "i".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const C = `C-${year}-001`;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500002001");
  finance = await createUser("966500002002");
  ownerB = await createUser("966500002003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'finance')", [org, finance]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو محمد','966511112222','1012345678') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{}',10000,15,1500,11500)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,11500,'sent') returning id", [org, quote, client])).rows[0].id;
    const p = await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'عند التوقيع',60,6900,'signing'),($1,$2,2,'عند التسليم',40,4600,'handover') returning id", [org, contract]);
    [pay1, pay2] = p.rows.map((r) => r.id);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [C, TOKEN]));
});
afterAll(closePool);

const invoices = () => asAdmin((q) => q<{ number: string; kind: string; subtotal: string; vat: string; total: string; buyer: { name: string } }>("select number, kind, subtotal, vat, total, buyer from public.invoices order by number")).then((r) => r.rows);

describe("invoices", () => {
  it("money received issues an invoice once; without a VAT number it is a plain invoice with no VAT", async () => {
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 3000, 'transfer', null)", [pay1]));
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 3900, 'cash', null)", [pay1]));
    const list = await invoices();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: `INV-${year}-001`, kind: "simple" });
    expect(Number(list[0].vat)).toBe(0);
    expect(Number(list[0].total)).toBe(6900);
    expect(list[0].buyer.name).toBe("أبو محمد");
  });

  it("with a VAT number the next invoice is a tax invoice with VAT split out", async () => {
    await as({ userId: owner }, (q) => q("update public.organizations set vat_number = '310000000000003' where id = $1", [org]));
    await as({ userId: finance }, (q) => q("select public.record_client_payment($1, current_date, 4600, 'transfer', null)", [pay2]));
    const inv = (await invoices())[1];
    expect(inv).toMatchObject({ number: `INV-${year}-002`, kind: "tax" });
    expect(Number(inv.subtotal)).toBe(4000);
    expect(Number(inv.vat)).toBe(600);
  });

  it("nobody writes invoices directly; other organizations see nothing; the client sees theirs with the token", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.invoices (organization_id, contract_id, payment_id, kind, issue_date, due_date, description, seller, buyer, subtotal, total) values ($1,$2,$3,'simple',current_date,current_date,'x','{}','{}',1,1)", [org, contract, pay1])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.invoices set total = 1")));
    expect((await as({ userId: ownerB }, (q) => q("select 1 from public.invoices"))).rowCount).toBe(0);
    expect((await as({ userId: finance }, (q) => q("select 1 from public.invoices"))).rowCount).toBe(2);
    const docs = await as("service_role", (q) => q<{ d: { number: string; paid: number }[] }>("select public.portal_invoice_docs($1,$2) as d", [C, TOKEN]));
    expect(docs.rows[0].d.map((x) => x.number)).toEqual([`INV-${year}-001`, `INV-${year}-002`]);
    expect(Number(docs.rows[0].d[0].paid)).toBe(6900);
    const bad = await as("service_role", (q) => q<{ d: unknown }>("select public.portal_invoice_docs($1,$2) as d", [C, "tok_" + "z".repeat(40)]));
    expect(bad.rows[0].d).toBeNull();
  });
});
