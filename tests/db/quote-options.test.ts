import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, org: string, quote: string, quote2: string, contract: string, client: string;
const TOKEN = "tok_" + "o".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const C = `C-${year}-001`;
const OPTS = JSON.stringify([{ version: 1, label: "جوتن" }, { version: 2, label: "الجزيرة" }]);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500004001");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'أبو سعد','966511114444') returning id", [org])).rows[0].id;
    quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'interior') returning id", [org, client])).rows[0].id;
    quote2 = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'interior') returning id", [org, client])).rows[0].id;
    for (const [t, qid] of [[11500, quote], [9200, quote], [5000, quote2]] as const) {
      await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{}',$3,0,0,$3)", [org, qid, t]);
      await q("select public.issue_quote($1, null)", [qid]);
    }
  });
});
afterAll(closePool);

describe("multi-option quotes", () => {
  it("options are 2–3 distinct versions of the same quote, each with a label", async () => {
    await as({ userId: owner }, (q) => q("update public.quotes set options = $2::jsonb where id = $1", [quote, OPTS]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = '[{\"version\":1,\"label\":\"x\"}]' where id = $1", [quote])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = '[{\"version\":1,\"label\":\"a\"},{\"version\":1,\"label\":\"b\"}]' where id = $1", [quote])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = '[{\"version\":1,\"label\":\"a\"},{\"version\":3,\"label\":\"b\"}]' where id = $1", [quote])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = '[{\"version\":1,\"label\":\"a\",\"x\":1},{\"version\":2,\"label\":\"b\"}]' where id = $1", [quote])));
    // a version of another quote is refused
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set options = $2::jsonb where id = $1", [quote2, OPTS])));
  });

  it("the client picks an option while accepting; the contract and payments follow it", async () => {
    await as({ userId: owner }, async (q) => {
      // the offer changed (options set) → issued again before the contract
      await q("select public.issue_quote($1, null)", [quote]);
      contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status, options) values ($1,$2,1,$3,'interior',current_date,10,11500,'sent',$4::jsonb) returning id", [org, quote, client, OPTS])).rows[0].id;
      await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'دفعة 1',33.33,3833.00,'signing'),($1,$2,2,'دفعة 2',66.67,7667.00,'handover')", [org, contract]);
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
    });
    // pointing a contract outside its options is refused
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set quote_version = 3 where id = $1", [contract])));
    const opts = await as("service_role", (q) => q<{ o: { version: number; label: string; total: string }[] }>("select public.portal_options($1,$2) as o", [C, TOKEN]));
    expect(opts.rows[0].o.map((o) => [o.version, o.label, Number(o.total)])).toEqual([[1, "جوتن", 11500], [2, "الجزيرة", 9200]]);
    // no choice → refused; a version that isn't offered → refused
    await expect(as("service_role", (q) => q("select public.portal_accept($1,$2,'سعد',null,'1.1.1.1','x')", [C, TOKEN]))).rejects.toThrow(/choose an option/);
    await expect(as("service_role", (q) => q("select public.portal_accept($1,$2,'سعد',null,'1.1.1.1','x',3)", [C, TOKEN]))).rejects.toThrow(/choose an option/);
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'سعد',null,'1.1.1.1','x',2)", [C, TOKEN]));
    const c = await asAdmin((q) => q<{ status: string; quote_version: number; total: string }>("select status, quote_version, total from public.contracts where id = $1", [contract]));
    expect(c.rows[0]).toMatchObject({ status: "accepted", quote_version: 2 });
    expect(Number(c.rows[0].total)).toBe(9200);
    const p = await asAdmin((q) => q<{ amount: string }>("select amount from public.contract_payments where contract_id = $1 order by seq", [contract]));
    expect(p.rows.map((r) => Number(r.amount))).toEqual([3066.36, 6133.64]);
  });

  it("an accepted contract's options can't change", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set options = null where id = $1", [contract])));
  });
});
