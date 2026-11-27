import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectCostRows } from "@/lib/purchases";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * Marketers on commission (owner, Nov 2026): the percentage is frozen with the priced version and
 * copied to the contract; the commission is due once the ORIGINAL contract is fully paid (never the
 * addenda); paying it (finance.manage, once) issues a PV- voucher and becomes a project cost;
 * the marketer follows his own page by link + token (service role only).
 */
let owner: string, fin: string, sup: string, viewer: string, restricted: string, other: string;
let org: string, orgB: string, client: string, marketer: string, marketerNo: string, marketerB: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const tok = () => randomBytes(12).toString("base64url");

type Made = { id: string; number: string; quote: string; token: string; payments: string[] };

/** Saves a priced version through save_quote_version (as the server), like the app does. */
async function saveVersion(q: Q, quote: string, subtotal: number, mk: string | null, percent: number, discount = 0) {
  await q("set local role service_role");
  const payload = {
    version: { selection: {}, quantities: {}, client_view: { workTypes: [] }, subtotal, discount, vat_percent: 0, vat: 0, total: subtotal - discount, problems: 0 },
    costs: { cost: 1000, cost_with_contingency: 1050, margin_percent: 30, lines: [], purchase_list: [], marketer_id: mk, commission_percent: percent },
  };
  const r = await q<{ id: string; version: number }>("select * from public.save_quote_version($1,$2,$3::jsonb)", [owner, quote, JSON.stringify(payload)]);
  await q("set local role authenticated");
  return r.rows[0];
}

async function makeContract(subtotal: number, opts: { marketer?: string | null; percent?: number; discount?: number; accept?: boolean; percents?: number[] } = {}): Promise<Made> {
  const token = tok();
  const mk = opts.marketer === undefined ? marketer : opts.marketer;
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await saveVersion(q, quote, subtotal, mk, opts.percent ?? (mk ? 5 : 0), opts.discount ?? 0);
    await q("select public.issue_quote($1, null)", [quote]);
    const total = subtotal - (opts.discount ?? 0);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,$4,'sent') returning id, number", [org, quote, client, total])).rows[0];
    const payments: string[] = [];
    for (const [i, p] of (opts.percents ?? [50, 50]).entries()) {
      payments.push((await q<{ id: string }>("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,$3,$4,$5,$6,$7) returning id", [org, c.id, i + 1, `دفعة ${i + 1}`, p, Math.round(total * p) / 100, i === 0 ? "signing" : "custom"])).rows[0].id);
    }
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, quote, token, payments };
  });
  if (opts.accept !== false) await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}
const commission = (contract: string) =>
  asAdmin((q) => q<{ id: string; status: string; percent: string; amount: string; base: string; marketer_id: string }>("select * from public.marketer_commissions where contract_id = $1", [contract])).then((r) => r.rows[0]);
const pay = (u: string, p: string, amount: number) => as({ userId: u }, (q) => q("select public.record_client_payment($1, current_date, $2, 'transfer', null)", [p, amount]));
const payCommission = (u: string, k: string) => as({ userId: u }, (q) => q<{ n: string }>("select public.record_commission_payment($1, (now() at time zone 'Asia/Riyadh')::date, 'transfer', 'TRX-1', null) as n", [k])).then((r) => r.rows[0].n);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500011001");
  fin = await createUser("966500011002");
  sup = await createUser("966500011003");
  viewer = await createUser("966500011004");
  restricted = await createUser("966500011005");
  other = await createUser("966500011006");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: other }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'finance'),($1,$3,'supervisor'),($1,$4,'viewer'),($1,$5,'finance')", [org, fin, sup, viewer, restricted]);
    await q("update public.memberships set project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'أبو خالد','966511112222','1012345678') returning id", [org])).rows[0].id;
    const m = (await q<{ id: string; number: string }>("insert into public.marketers (organization_id, name, phone, commission_percent, iban) values ($1,'سعد المسوّق','966500000777',5,'SA0380000000608010167519') returning id, number", [org])).rows[0];
    marketer = m.id;
    marketerNo = m.number;
  });
  marketerB = await as({ userId: other }, async (q) => (await q<{ id: string }>("insert into public.marketers (organization_id, name, commission_percent) values ($1,'مسوق ب',3) returning id", [orgB])).rows[0].id);
});
afterAll(closePool);

describe("marketers: records and permissions", () => {
  it("numbers MK-, only marketers.manage writes, finance.view reads, others don't", async () => {
    expect(marketerNo).toMatch(/^MK-\d{4}-\d{3}$/);
    await expectDenied(as({ userId: sup }, (q) => q("insert into public.marketers (organization_id, name) values ($1,'x y')", [org])), /row-level security/);
    const seen = await as({ userId: fin }, (q) => q("select id from public.marketers where organization_id = $1", [org]));
    expect(seen.rowCount).toBe(1);
    expect((await as({ userId: viewer }, (q) => q("select id from public.marketers"))).rowCount).toBe(0);
    expect((await as({ userId: other }, (q) => q("select id from public.marketers where organization_id = $1", [org]))).rowCount).toBe(0);
    await expectDenied(as({ userId: owner }, (q) => q("update public.marketers set commission_percent = 60 where id = $1", [marketer])), /check/);
  });

  it("names for pickers (marketer_choices): no phone/IBAN; the percentage only with costs.view", async () => {
    const v = await as({ userId: viewer }, (q) => q<{ name: string; commission_percent: string | null }>("select * from public.marketer_choices($1)", [org]));
    expect(v.rows.map((r) => [r.name, r.commission_percent])).toEqual([["سعد المسوّق", null]]);
    expect(Object.keys(v.rows[0])).not.toContain("phone");
    const s = await as({ userId: sup }, (q) => q<{ commission_percent: string }>("select * from public.marketer_choices($1)", [org]));
    expect(Number(s.rows[0].commission_percent)).toBe(5);
    expect((await as({ userId: other }, (q) => q("select * from public.marketer_choices($1)", [org]))).rowCount).toBe(0);
  });

  it("a client / quote can't point at another organization's marketer; users can't set a quote's marketer directly", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.clients set marketer_id = $1 where id = $2", [marketerB, client])), /another organization/);
    await as({ userId: owner }, (q) => q("update public.clients set marketer_id = $1 where id = $2", [marketer, client]));
    const qid = await as({ userId: owner }, async (q) => (await q<{ id: string; marketer_id: string | null }>("insert into public.quotes (organization_id, client_id, service, marketer_id) values ($1,$2,'gypsum',$3) returning id, marketer_id", [org, client, marketer])).rows[0]);
    expect(qid.marketer_id).toBeNull();
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set marketer_id = $1 where id = $2", [marketer, qid.id])), /priced version/);
  });
});

describe("the percentage is frozen with the priced version", () => {
  it("save_quote_version stores marketer, percentage and the amount on the net before VAT; refuses a stale percentage", async () => {
    await as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      const v = await saveVersion(q, quote, 20000, marketer, 5, 1000);
      const c = await q<{ marketer_id: string; commission_percent: string; commission_amount: string }>("select marketer_id, commission_percent, commission_amount from public.quote_version_costs where quote_version_id = $1", [v.id]);
      expect([c.rows[0].marketer_id, Number(c.rows[0].commission_percent), Number(c.rows[0].commission_amount)]).toEqual([marketer, 5, 950]);
      const qr = await q<{ marketer_id: string }>("select marketer_id from public.quotes where id = $1", [quote]);
      expect(qr.rows[0].marketer_id).toBe(marketer);
      await expectDenied(saveVersion(q, quote, 20000, marketer, 4), /commission changed/);
    });
    await as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await expectDenied(saveVersion(q, quote, 1000, marketerB, 3), /another organization/);
    });
    await as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await expectDenied(saveVersion(q, quote, 1000, null, 5), /without a marketer/);
    });
  });

  it("removing the marketer on a new version clears the quote's marketer and charges nothing", async () => {
    const c = await makeContract(8000, { marketer: null });
    expect(await commission(c.id)).toBeUndefined();
    const k = await asAdmin((q) => q<{ marketer_id: string | null }>("select marketer_id from public.contracts where id = $1", [c.id]));
    expect(k.rows[0].marketer_id).toBeNull();
  });

  it("the contract keeps the version's percentage after the owner changes it; acceptance creates the commission (expected)", async () => {
    const c = await makeContract(10000, { accept: false });
    await as({ userId: owner }, (q) => q("update public.marketers set commission_percent = 8 where id = $1", [marketer]));
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [c.number, c.token]));
    const k = await commission(c.id);
    expect([k.status, Number(k.percent), Number(k.base), Number(k.amount), k.marketer_id]).toEqual(["expected", 5, 10000, 500, marketer]);
    const ct = await asAdmin((q) => q<{ marketer_id: string }>("select marketer_id from public.contracts where id = $1", [c.id]));
    expect(ct.rows[0].marketer_id).toBe(marketer);
    // an accepted contract's marketer stays
    await as({ userId: owner }, (q) => q("update public.contracts set marketer_id = null where id = $1", [c.id]));
    expect((await asAdmin((q) => q<{ marketer_id: string }>("select marketer_id from public.contracts where id = $1", [c.id]))).rows[0].marketer_id).toBe(marketer);
    await as({ userId: owner }, (q) => q("update public.marketers set commission_percent = 5 where id = $1", [marketer]));
  });

  it("users can't write commissions or vouchers directly", async () => {
    const c = await makeContract(5000);
    const k = await commission(c.id);
    await expectDenied(as({ userId: owner }, (q) => q("update public.marketer_commissions set status = 'due' where id = $1", [k.id])), /permission denied/);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.marketer_commissions (organization_id, contract_id, marketer_id, base, percent, amount) values ($1,$2,$3,1,1,1)", [org, c.id, marketer])), /permission denied/);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.commission_payments (organization_id, commission_id, marketer_id, contract_id, amount, paid_on) values ($1,$2,$3,$4,1,current_date)", [org, k.id, marketer, c.id])), /permission denied/);
  });
});

describe("due only after the original contract is fully paid", () => {
  it("partial payments and addenda never make it due; the last payment does (+ notification to finance.manage)", async () => {
    const c = await makeContract(10000);
    const k = await commission(c.id);
    await pay(fin, c.payments[0], 5000);
    await pay(fin, c.payments[1], 4999);
    expect((await commission(c.id)).status).toBe("expected");
    // an addendum fully paid doesn't count
    const ad = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.addenda (organization_id, contract_id, title, description, amount, vat_percent, vat, total, extra_days) values ($1,$2,'إضافة','أعمال',1000,0,0,1000,1) returning id", [org, c.id])).rows[0].id);
    await asAdmin((a) => a("update public.addenda set status = 'accepted', accepted_at = now(), payment_status = 'requested' where id = $1", [ad]));
    await asAdmin((a) => a("update public.addenda set payment_status = 'paid', paid_amount = 1000, paid_at = current_date where id = $1", [ad]));
    expect((await commission(c.id)).status).toBe("expected");
    await expectDenied(payCommission(fin, k.id), /not due/);
    await pay(fin, c.payments[1], 1);
    const due = await commission(c.id);
    expect(due.status).toBe("due");
    const n = await asAdmin((q) => q<{ user_id: string }>("select user_id from public.notifications where kind = 'commission_due' and dedupe_key like $1", [`commission_due:${k.id}:%`]));
    expect(n.rows.map((r) => r.user_id).sort()).toEqual([owner, fin, restricted].filter((u) => u !== restricted).sort());
  });

  it("payment: finance.manage with project access, once, the full amount → PV voucher + project cost", async () => {
    const c = await makeContract(4000, { percents: [100] });
    const k = await commission(c.id);
    await pay(fin, c.payments[0], 4000);
    expect((await commission(c.id)).status).toBe("due");
    await expectDenied(payCommission(sup, k.id), /not allowed/);
    await expectDenied(payCommission(viewer, k.id), /not allowed/);
    await expectDenied(payCommission(restricted, k.id), /not allowed/);
    await expectDenied(payCommission(other, k.id), /not allowed/);
    const number = await payCommission(fin, k.id);
    expect(number).toMatch(/^PV-\d{4}-\d{3}$/);
    await expectDenied(payCommission(fin, k.id), /already paid/);
    const v = await asAdmin((q) => q<{ amount: string; marketer_id: string; method: string; reference: string }>("select amount, marketer_id, method, reference from public.commission_payments where commission_id = $1", [k.id]));
    expect([Number(v.rows[0].amount), v.rows[0].marketer_id, v.rows[0].method, v.rows[0].reference]).toEqual([200, marketer, "transfer", "TRX-1"]);
    expect((await commission(c.id)).status).toBe("paid");
    const a = await asAdmin((q) => q<{ commission: string }>("select commission from private.project_actuals($1)", [c.id]));
    expect(Number(a.rows[0].commission)).toBe(200);
    // the app's project cost (loadProjectCosts → projectCostRows) gives the same figure, inside the actual cost
    const paid = await as({ userId: fin }, (q) => q<{ contract_id: string; amount: string }>("select contract_id, amount from public.commission_payments where contract_id = $1", [c.id]));
    const [row] = projectCostRows({
      contracts: [{ id: c.id, number: c.number, client_id: client, status: "accepted" }], clients: [], moves: [], purchases: [], subWork: [], agreements: [], petty: [], repairs: [],
      labour: null, expenseLines: [], estimates: new Map(), vatRegistered: false, commissions: paid.rows,
    });
    expect(row.commission).toBe(Number(a.rows[0].commission));
    expect(row.actual).toBe(200);
    // the voucher can't be edited
    await expectDenied(as({ userId: owner }, (q) => q("update public.commission_payments set amount = 1 where commission_id = $1", [k.id])), /permission denied/);
  });

  it("users can't move an accepted contract out of accepted; a cancellation never cancels a due or paid reward", async () => {
    const c = await makeContract(3000, { percents: [100] });
    await expectDenied(as({ userId: owner }, (q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id])), /cannot change/);
    expect((await commission(c.id)).status).toBe("expected");
    // (the server / an admin may still cancel) expected → cancelled
    await asAdmin((q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id]));
    expect((await commission(c.id)).status).toBe("cancelled");
    const d = await makeContract(3000, { percents: [100] });
    await pay(fin, d.payments[0], 3000);
    await asAdmin((q) => q("update public.contracts set status = 'cancelled' where id = $1", [d.id]));
    expect((await commission(d.id)).status).toBe("due");
  });

  it("a reward can't be paid with a date before it became due (Riyadh day)", async () => {
    const c = await makeContract(2000, { percents: [100] });
    await pay(fin, c.payments[0], 2000);
    const k = await commission(c.id);
    await expectDenied(as({ userId: fin }, (q) => q("select public.record_commission_payment($1, (now() at time zone 'Asia/Riyadh')::date - 1, 'cash', null, null)", [k.id])), /before the reward was due/);
  });

  it("a due reward unpaid after 7 days is reminded (finance.manage), linked to its card", async () => {
    const c = await makeContract(2500, { percents: [100] });
    await pay(fin, c.payments[0], 2500);
    const k = await commission(c.id);
    await asAdmin((q) => q("update public.marketer_commissions set due_at = now() - interval '7 days' where id = $1", [k.id]));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q<{ user_id: string; link: string }>("select user_id, link from public.notifications where dedupe_key = $1", [`commission_due:${k.id}:7`]));
    expect(n.rows.map((r) => r.user_id).sort()).toEqual([owner, fin].sort());
    expect(n.rows[0].link).toBe(`/partners?k=${k.id}`);
  });

  it("the paid reward counts in the daily 'project losing' check (actual cost)", async () => {
    const c = await makeContract(1000, { percents: [100], percent: 5 });
    await pay(fin, c.payments[0], 1000);
    await payCommission(fin, (await commission(c.id)).id);
    // + 960 petty-cash expense: without the reward the project would still be at +40
    await as({ userId: owner }, async (q) => {
      const acc = (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة') on conflict (organization_id, holder_id) do update set name = excluded.name returning id", [org, owner])).rows[0].id;
      await q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, contract_id, description) values ($1,$2,'expense',960,$3,'مصروف')", [org, acc, c.id]);
    });
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q("select 1 from public.notifications where dedupe_key = $1", [`losing:${c.id}:loss`]));
    expect(n.rowCount).toBeGreaterThan(0);
  });

  it("a contract with options takes the chosen option's partner and percentage", async () => {
    const token = tok();
    const made = await as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      await saveVersion(q, quote, 10000, marketer, 5); // option 1: the partner at 5 %
      await saveVersion(q, quote, 9000, null, 0); // option 2: no partner
      const opts = JSON.stringify([{ version: 1, label: "أ" }, { version: 2, label: "ب" }]);
      await q("update public.quotes set options = $2::jsonb where id = $1", [quote, opts]);
      await q("select public.issue_quote($1, null)", [quote]);
      const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status, options) values ($1,$2,2,$3,'gypsum',current_date,10,9000,'sent',$4::jsonb) returning id, number", [org, quote, client, opts])).rows[0];
      await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,9000,'custom')", [org, c.id]);
      await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
      return c;
    });
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x',1)", [made.number, token]));
    const k = await commission(made.id);
    expect([Number(k.percent), Number(k.base), Number(k.amount), k.marketer_id]).toEqual([5, 10000, 500, marketer]);
  });

  it("the quote remembers that its partner was chosen (removed on purpose ≠ never set)", async () => {
    const q1 = await as({ userId: owner }, async (q) => {
      const quote = (await q<{ id: string; marketer_set: boolean }>("insert into public.quotes (organization_id, client_id, service, marketer_set) values ($1,$2,'gypsum',true) returning id, marketer_set", [org, client])).rows[0];
      expect(quote.marketer_set).toBe(false);
      await saveVersion(q, quote.id, 1000, null, 0);
      return quote.id;
    });
    const r = await asAdmin((q) => q<{ marketer_set: boolean; marketer_id: string | null }>("select marketer_set, marketer_id from public.quotes where id = $1", [q1]));
    expect(r.rows[0]).toEqual({ marketer_set: true, marketer_id: null });
    await expectDenied(as({ userId: owner }, (q) => q("update public.quotes set marketer_set = false where id = $1", [q1])), /priced version/);
  });

  it("read access: finance / costs / marketers.manage; never viewers, other organizations or projects outside a restricted member's scope", async () => {
    const c = await makeContract(2000);
    const count = (u: string) => as({ userId: u }, (q) => q("select id from public.marketer_commissions where contract_id = $1", [c.id])).then((r) => r.rowCount);
    expect(await count(fin)).toBe(1);
    expect(await count(sup)).toBe(1); // costs.view
    expect(await count(viewer)).toBe(0);
    expect(await count(restricted)).toBe(0);
    expect(await count(other)).toBe(0);
  });

  it("Qoyod: a commission payment queues an expense bill and its payment (mk: / mkp:)", async () => {
    await as({ userId: owner }, (q) => q("insert into public.qoyod_settings (organization_id, enabled) values ($1, true) on conflict (organization_id) do update set enabled = true", [org]));
    const c = await makeContract(6000, { percents: [100] });
    const k = await commission(c.id);
    await pay(fin, c.payments[0], 6000);
    await payCommission(fin, k.id);
    const jobs = await asAdmin((q) => q<{ kind: string; ref: string; amount: string | null; entity_type: string }>("select kind, ref, amount, entity_type from public.qoyod_sync_jobs where entity_type = 'commission_payment' order by kind"));
    expect(jobs.rows.map((j) => [j.kind, j.ref.split(":")[0], j.amount == null ? null : Number(j.amount)])).toEqual([["bill", "mk", null], ["bill_payment", "mkp", 300]]);
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set enabled = false where organization_id = $1", [org]));
  });
});

describe("the marketer's page", () => {
  const view = (n: string, t: string) => as("service_role", (q) => q<{ v: Record<string, unknown> | null }>("select public.marketer_portal_view($1,$2) as v", [n, t])).then((r) => r.rows[0].v);

  it("only marketers.manage issues / revokes links; a new link revokes the old one", async () => {
    const t1 = tok();
    await expectDenied(as({ userId: fin }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t1)])), /not allowed/);
    await expectDenied(as({ userId: other }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t1)])), /not allowed/);
    await as({ userId: owner }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t1)]));
    expect(await view(marketerNo, t1)).not.toBeNull();
    const t2 = tok();
    await as({ userId: owner }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t2)]));
    expect(await view(marketerNo, t1)).toBeNull();
    expect(await view(marketerNo, t2)).not.toBeNull();
    await expectDenied(as({ userId: fin }, (q) => q("select public.revoke_marketer_links($1)", [marketer])), /not allowed/);
    await as({ userId: owner }, (q) => q("select public.revoke_marketer_links($1)", [marketer]));
    expect(await view(marketerNo, t2)).toBeNull();
  });

  it("shows only his contracts: client name, contract, value, percentage, commission, vouchers — no costs, phones or IDs", async () => {
    const t = tok();
    await as({ userId: owner }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t)]));
    const v = (await view(marketerNo, t)) as { marketer: Record<string, unknown>; items: Record<string, unknown>[] };
    expect(v.marketer.name).toBe("سعد المسوّق");
    expect(v.items.length).toBeGreaterThan(0);
    const text = JSON.stringify(v);
    for (const secret of ["966511112222", "1012345678", "966500000777", "SA038", "cost", "margin", "quote"]) expect(text).not.toContain(secret);
    expect(Object.keys(v.items[0]).sort()).toEqual(["amount", "base", "client", "contract", "contract_status", "date", "due_at", "handed_over", "paid_amount", "paid_at", "percent", "status", "vouchers"]);
    expect(v.items.every((i) => i.client === "أبو خالد")).toBe(true);
    // wrong token, wrong number, anonymous and signed-in callers
    expect(await view(marketerNo, tok())).toBeNull();
    expect(await view("MK-2026-999", t)).toBeNull();
    await expectDenied(as({ userId: owner }, (q) => q("select public.marketer_portal_view($1,$2)", [marketerNo, t])), /permission denied/);
    await expectDenied(as("anon", (q) => q("select public.marketer_portal_view($1,$2)", [marketerNo, t])), /permission denied/);
    // deactivating the marketer closes his page
    await as({ userId: owner }, (q) => q("update public.marketers set is_active = false where id = $1", [marketer]));
    expect(await view(marketerNo, t)).toBeNull();
    await as({ userId: owner }, (q) => q("update public.marketers set is_active = true where id = $1", [marketer]));
  });

  it("his voucher (print / PDF) only through his own link", async () => {
    const t = tok();
    await as({ userId: owner }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t)]));
    const pv = (await asAdmin((q) => q<{ number: string }>("select number from public.commission_payments where marketer_id = $1 limit 1", [marketer]))).rows[0].number;
    const get = (n: string, tk: string, v: string) => as("service_role", (q) => q<{ v: Record<string, unknown> | null }>("select public.marketer_portal_voucher($1,$2,$3) as v", [n, tk, v])).then((r) => r.rows[0].v);
    const doc = (await get(marketerNo, t, pv)) as { voucher: { number: string }; contract: { client: string } };
    expect(doc.voucher.number).toBe(pv);
    expect(JSON.stringify(doc)).not.toMatch(/966511112222|1012345678|margin|cost/);
    expect(await get(marketerNo, tok(), pv)).toBeNull();
    expect(await get(marketerNo, t, "PV-2099-999")).toBeNull();
    await expectDenied(as({ userId: owner }, (q) => q("select public.marketer_portal_voucher($1,$2,$3)", [marketerNo, t, pv])), /permission denied/);
  });

  it("deactivating the partner revokes his open links", async () => {
    const t = tok();
    await as({ userId: owner }, (q) => q("select public.issue_marketer_link($1,$2)", [marketer, hash(t)]));
    await as({ userId: owner }, (q) => q("update public.marketers set is_active = false where id = $1", [marketer]));
    const open = await asAdmin((q) => q("select 1 from public.marketer_portal_links where marketer_id = $1 and revoked_at is null", [marketer]));
    expect(open.rowCount).toBe(0);
    await as({ userId: owner }, (q) => q("update public.marketers set is_active = true where id = $1", [marketer]));
  });
});

describe("deleting a partner with contracts and rewards", () => {
  it("the owner can't delete a partner a contract / reward / voucher points at", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("select public.delete_marketer($1)", [marketer])), /partner has records/);
    const left = await asAdmin((q) => q("select 1 from public.marketers where id = $1", [marketer]));
    expect(left.rowCount).toBe(1);
  });
});
