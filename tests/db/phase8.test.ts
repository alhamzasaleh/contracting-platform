import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, ownerB: string;
let org: string, contract: string, addendum: string, sub: string, agreementM2: string, agreementLump: string, account: string;
const year = new Date().getFullYear();
const TOKEN = "tok_" + "a".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001101");
  supervisor = await createUser("966500001102");
  ownerB = await createUser("966500001103");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("select public.seed_starter_catalogue($1)", [org]);
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, supervisor]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id", [org, quote, client])).rows[0].id;
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
});
afterAll(closePool);

const C = () => `C-${year}-001`;

describe("addenda (additional works)", () => {
  it("only for an accepted contract", async () => {
    await expectDenied(
      as({ userId: supervisor }, (q) => q("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'فتحة','x y',100,100)", [org, contract])),
      /accepted contract/,
    );
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [C(), TOKEN]));
  });

  it("supervisor's addendum needs the owner's approval, then goes to the client", async () => {
    addendum = await as({ userId: supervisor }, async (q) => {
      const a = (await q<{ id: string; number: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, vat, total, extra_days) values ($1,$2,'بيت إنارة إضافي','بيت إنارة 12 م في المجلس',1800,0,1800,3) returning id, number", [org, contract])).rows[0];
      expect(a.number).toBe(`AD-${year}-001`);
      const s = await q<{ s: string }>("select public.submit_addendum($1) as s", [a.id]);
      expect(s.rows[0].s).toBe("pending_approval");
      return a.id;
    });
    // nothing reaches the client before approval
    const before = await as("service_role", (q) => q<{ v: unknown[] }>("select public.portal_addenda($1,$2) as v", [C(), TOKEN]));
    expect(before.rows[0].v).toHaveLength(0);
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.addenda set status = 'sent' where id = $1", [addendum])), /submit_addendum/);
    await as({ userId: owner }, (q) => q("update public.approvals set status = 'approved' where entity_id = $1", [addendum]));
    await as({ userId: supervisor }, (q) => q("update public.addenda set status = 'sent' where id = $1", [addendum]));
    await expectDenied(as({ userId: supervisor }, (q) => q("update public.addenda set amount = 1, total = 1 where id = $1", [addendum])), /only drafts/);
  });

  it("no purchases or progress on it before the client accepts", async () => {
    await expectDenied(
      as({ userId: supervisor }, (q) => q("insert into public.purchases (organization_id, contract_id, addendum_id) values ($1,$2,$3)", [org, contract, addendum])),
      /accepts the addendum/,
    );
    await expectDenied(as({ userId: owner }, (q) => q("update public.addenda set status = 'accepted' where id = $1", [addendum])), /only the client/);
  });

  it("client accepts: payment requested, its stage added before the final handover", async () => {
    const ok = await as("service_role", (q) => q<{ ok: boolean }>("select public.portal_accept_addendum($1,$2,$3,'محمد',null,'1.1.1.1','Safari') as ok", [C(), TOKEN, addendum]));
    expect(ok.rows[0].ok).toBe(true);
    const a = await as({ userId: owner }, (q) => q<{ status: string; payment_status: string }>("select status, payment_status from public.addenda where id = $1", [addendum]));
    expect(a.rows[0]).toEqual({ status: "accepted", payment_status: "requested" });
    const st = await as({ userId: owner }, (q) => q<{ name: string; is_final: boolean; addendum_id: string | null }>("select name, is_final, addendum_id from public.project_stages where contract_id = $1 order by seq", [contract]));
    expect(st.rows.at(-1)!.is_final).toBe(true);
    expect(st.rows.at(-2)!.addendum_id).toBe(addendum);
    await as({ userId: supervisor }, (q) => q("insert into public.purchases (organization_id, contract_id, addendum_id) values ($1,$2,$3)", [org, contract, addendum]));
  });
});

describe("subcontractors", () => {
  it("earned is computed from the agreement (per m² and lump)", async () => {
    await as({ userId: supervisor }, async (q) => {
      sub = (await q<{ id: string }>("insert into public.subcontractors (organization_id, name, services) values ($1,'مؤسسة الإتقان','{gypsum}') returning id", [org])).rows[0].id;
      agreementM2 = (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, quantity_m2, schedule) values ($1,$2,$3,'تركيب أسقف','per_m2',15,400,'weekly') returning id", [org, sub, contract])).rows[0].id;
      agreementLump = (await q<{ id: string }>("insert into public.subcontractor_agreements (organization_id, subcontractor_id, contract_id, scope, basis, rate, schedule) values ($1,$2,$3,'معجون','lump',8000,'progress') returning id", [org, sub, contract])).rows[0].id;
      const w1 = await q<{ amount: string }>("insert into public.subcontractor_work (organization_id, agreement_id, quantity_m2, amount) values ($1,$2,120,999999) returning amount", [org, agreementM2]);
      expect(Number(w1.rows[0].amount)).toBe(1800);
      const w2 = await q<{ amount: string }>("insert into public.subcontractor_work (organization_id, agreement_id, percent, amount) values ($1,$2,25,0) returning amount", [org, agreementLump]);
      expect(Number(w2.rows[0].amount)).toBe(2000);
    });
  });

  it("paying is finance's job", async () => {
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.subcontractor_payments (organization_id, agreement_id, amount) values ($1,$2,500)", [org, agreementM2])));
    await as({ userId: owner }, (q) => q("insert into public.subcontractor_payments (organization_id, agreement_id, amount, method) values ($1,$2,1500,'transfer')", [org, agreementM2]));
  });
});

describe("petty cash", () => {
  it("finance tops up; the holder logs expenses; entries can't be edited", async () => {
    account = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة المشرف') returning id", [org, supervisor])).rows[0].id);
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'topup',1000,'x')", [org, account])), /only finance/);
    await as({ userId: owner }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'topup',1000,'تعبئة')", [org, account]));
    await as({ userId: supervisor }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description, contract_id) values ($1,$2,'expense',85,'شريط وأكياس',$3)", [org, account, contract]));
    // no one can rewrite the ledger (no update/delete rights): nothing changes
    const upd = await as({ userId: owner }, (q) => q("update public.petty_cash_entries set amount = 1 returning id")).catch(() => ({ rowCount: 0 }));
    expect(upd.rowCount).toBe(0);
    const bal = await as({ userId: supervisor }, (q) => q<{ b: string }>("select sum(case kind when 'topup' then amount else -amount end) as b from public.petty_cash_entries where account_id = $1", [account]));
    expect(Number(bal.rows[0].b)).toBe(915);
  });

  it("a topup can't be charged to a project; attachments must be this org's files", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description, contract_id) values ($1,$2,'topup',5,'x',$3)", [org, account, contract])));
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description, attachment_path) values ($1,$2,'expense',5,'x','../x.jpg')", [org, account])), /invalid attachment/);
  });

  it("other organizations see nothing", async () => {
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.addenda) + (select count(*)::int from public.subcontractors) + (select count(*)::int from public.petty_cash_entries) + (select count(*)::int from public.subcontractor_work) as n"));
    expect(b.rows[0].n).toBe(0);
  });
});
