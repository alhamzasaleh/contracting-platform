import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, resetDatabase } from "./db";

/**
 * The success partner's reward follows what the client really pays (owner, Nov 2026):
 * base = agreed value before VAT + the quantity settlement the client signed.
 */
let owner: string, fin: string, org: string, client: string, marketer: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const SIG = "data:image/png;base64,iVBORw0KGgo=";
// ceilings 100 m² × 50 → 5000 net, no VAT; reward 5 % = 250
const VIEW = JSON.stringify({ method: "unit", service: "gypsum", discountPercent: 0, vatPercent: 0, subtotal: 5000, discount: 0, workTypes: [{ workType: "ceilings", area: 100, pricePerM2: 50, total: 5000 }] });

async function makeContract() {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    const v = (await asServer<{ id: string }>(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}',$3::jsonb,5000,5000) returning id", [org, quote, VIEW])).rows[0].id;
    await asServer(q, "insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines, marketer_id, commission_percent, commission_amount) values ($1,$2,3000,3150,30,'[]',$3,5,250)", [v, org, marketer]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,5000,'sent') returning id, number", [org, quote, client])).rows[0];
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,5000,'signing')", [org, c.id]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '60 days')", [org, c.id, hash(token)]);
    return { ...c, token };
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}
const reward = (contract: string) => asAdmin(async (q) => (await q<{ id: string; base: string; amount: string; paid_amount: string; status: string }>("select * from public.marketer_commissions where contract_id = $1", [contract])).rows[0]);
const sign = async (c: { id: string; number: string; token: string }, measured: number) => {
  const m = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.contract_measurements (organization_id, contract_id, lines) values ($1,$2,$3::jsonb) returning id", [org, c.id, JSON.stringify([{ work_type: "ceilings", measured_area: measured }])])).rows[0].id);
  await as({ userId: owner }, (q) => q("select public.send_measurement($1)", [m]));
  await as("service_role", (q) => q("select public.portal_answer_measurement($1,$2,$3,true,'محمد',null,$4,'1.1.1.1','x')", [c.number, c.token, m, SIG]));
};
const payAll = async (contract: string) => {
  const ps = await asAdmin(async (q) => (await q<{ id: string; amount: string; paid: string | null; status: string }>("select id, amount, paid_amount as paid, status from public.contract_payments where contract_id = $1", [contract])).rows);
  for (const p of ps) {
    if (p.status === "paid") continue;
    if (p.status === "pending") await asAdmin((q) => q("update public.contract_payments set status = 'requested' where id = $1", [p.id]));
    await as({ userId: fin }, (q) => q("select public.record_client_payment($1, current_date, $2, 'transfer', null)", [p.id, Number(p.amount) - Number(p.paid ?? 0)]));
  }
};
const payReward = (k: string) => as({ userId: fin }, (q) => q("select public.record_commission_payment($1, (now() at time zone 'Asia/Riyadh')::date, 'transfer', null, null)", [k]));

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500005001");
  fin = await createUser("966500005002");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org R') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'finance')", [org, fin]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone, id_number) values ($1,'عميل','966511115555','1000000008') returning id", [org])).rows[0].id;
    marketer = (await q<{ id: string }>("insert into public.marketers (organization_id, name, commission_percent) values ($1,'شريك',5) returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("reward on what the client really pays", () => {
  it("a signed sheet changes the reward's base before it is paid (more m² → more, fewer → less)", async () => {
    const c = await makeContract();
    expect(Number((await reward(c.id)).amount)).toBe(250);
    await sign(c, 110); // +10 m² × 50 = +500 → base 5500 → 275
    let k = await reward(c.id);
    expect([Number(k.base), Number(k.amount)]).toEqual([5500, 275]);
    const c2 = await makeContract();
    await sign(c2, 80); // −1000 → base 4000 → 200
    k = await reward(c2.id);
    expect([Number(k.base), Number(k.amount)]).toEqual([4000, 200]);
  });

  it("raised after it was paid: the rest is paid in a second voucher once the contract is fully paid again", async () => {
    const c = await makeContract();
    await payAll(c.id);
    let k = await reward(c.id);
    expect(k.status).toBe("due");
    await payReward(k.id);
    expect((await reward(c.id)).status).toBe("paid");
    await sign(c, 110); // +500 settlement payment, reward 275 (25 left)
    k = await reward(c.id);
    expect([k.status, Number(k.amount), Number(k.paid_amount)]).toEqual(["expected", 275, 250]);
    await payAll(c.id); // the settlement payment comes in
    expect((await reward(c.id)).status).toBe("due");
    await payReward(k.id);
    k = await reward(c.id);
    expect([k.status, Number(k.paid_amount)]).toEqual(["paid", 275]);
    const v = await asAdmin((q) => q<{ amount: string }>("select amount from public.commission_payments where commission_id = $1 order by created_at", [k.id]));
    expect(v.rows.map((x) => Number(x.amount))).toEqual([250, 25]);
  });

  it("lowered after it was paid: finance is told, nothing is taken back", async () => {
    const c = await makeContract();
    await payAll(c.id);
    const k = await reward(c.id);
    await payReward(k.id);
    await sign(c, 90); // −500 → base 4500 → 225 (25 paid too much)
    const after = await reward(c.id);
    expect([after.status, Number(after.amount), Number(after.paid_amount)]).toEqual(["paid", 225, 250]);
    const n = await asAdmin((q) => q<{ params: { amount: number } }>("select params from public.notifications where kind = 'commission_overpaid' and user_id = $1", [fin]));
    expect(Number(n.rows[0].params.amount)).toBe(25);
  });

  it("due is told only when it really is due (after the settlement payment), with what is left", async () => {
    const c = await makeContract();
    await payAll(c.id);
    const k = await reward(c.id);
    await payReward(k.id);
    const dues = () => asAdmin(async (q) => (await q<{ amount: number }>("select (params->>'amount')::numeric as amount from public.notifications where kind = 'commission_due' and user_id = $1 and link = $2", [fin, `/partners?k=${k.id}`])).rows.map((x) => Number(x.amount)));
    const before = (await dues()).length;
    await sign(c, 110);
    expect((await dues()).length).toBe(before); // the settlement payment isn't paid yet
    await payAll(c.id);
    expect((await dues()).slice(before)).toEqual([25]);
  });

  it("raised then lowered back: paid again, nothing to pay, no stuck «due»", async () => {
    const VIEW2 = 0; void VIEW2;
    const c = await makeContract();
    await payAll(c.id);
    const k = await reward(c.id);
    await payReward(k.id);
    await sign(c, 110); // 275, expected
    expect((await reward(c.id)).status).toBe("expected");
    // the next sheet on the same contract can't re-measure ceilings; lower it by an admin re-base on the same sheet's total
    await asAdmin((q) => q("update public.contract_measurements set diff_subtotal = 0 where contract_id = $1", [c.id]));
    await asAdmin((q) => q("select private.commission_rebase($1)", [c.id]));
    const after = await reward(c.id);
    expect([after.status, Number(after.amount), Number(after.paid_amount)]).toEqual(["paid", 250, 250]);
  });

  it("a voucher keeps the base it was paid on", async () => {
    const c = await makeContract();
    await payAll(c.id);
    const k = await reward(c.id);
    await payReward(k.id);
    await sign(c, 110);
    const v = await asAdmin(async (q) => (await q<{ base: string; percent: string; paid_before: string }>("select base, percent, paid_before from public.commission_payments where commission_id = $1", [k.id])).rows[0]);
    expect([Number(v.base), Number(v.percent), Number(v.paid_before)]).toEqual([5000, 5, 0]);
  });

  it("daily reminders say what is left of a due reward", async () => {
    const c = await makeContract();
    await payAll(c.id);
    const k = await reward(c.id);
    await payReward(k.id);
    await sign(c, 110);
    await payAll(c.id);
    await asAdmin((q) => q("update public.marketer_commissions set due_at = now() - interval '7 days' where id = $1", [k.id]));
    await asAdmin((q) => q("select public.run_daily_reminders()"));
    const n = await asAdmin((q) => q<{ amount: string }>("select params->>'amount' as amount from public.notifications where kind = 'commission_due' and dedupe_key like $1 and user_id = $2", [`commission_due:${k.id}:7%`, fin]));
    expect(n.rows.map((x) => Number(x.amount))).toEqual([25]);
  });
});
