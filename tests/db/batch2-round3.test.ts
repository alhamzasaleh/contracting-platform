import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Review of batch 2, third round (Nov 2026):
 * #4 Qoyod petty cash: one reconciliation keeps the cash account equal to the real balance ·
 * #5 a new client-page link is issued and the older ones revoked in one locked step.
 */
let owner: string, sup: string, restricted: string;
let org: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const newHash = () => hash(randomBytes(16).toString("hex"));
const in30 = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

async function makeContract(opts: { start?: string; warranty?: number; accept?: boolean } = {}) {
  const token = "tok_" + randomBytes(24).toString("hex");
  const made = await as({ userId: owner }, async (q) => {
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',5000,5000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    const c = (await q<{ id: string; number: string }>(
      "insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, warranty_months, total, status) values ($1,$2,1,$3,'gypsum',$4,10,$5,5000,'sent') returning id, number",
      [org, quote, client, opts.start ?? new Date().toISOString().slice(0, 10), opts.warranty ?? 6],
    )).rows[0];
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'دفعة',100,5000,'signing')", [org, c.id]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, c.id, hash(token)]);
    return { id: c.id, number: c.number, token };
  });
  if (opts.accept) await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [made.number, made.token]));
  return made;
}

const openLinks = (contract: string) =>
  asAdmin((q) => q<{ id: string; token_hash: string }>("select id, token_hash from public.client_portal_links where contract_id = $1 and revoked_at is null", [contract])).then((r) => r.rows);
const issue = (user: string, contract: string, tokenHash = newHash(), expires = in30()) =>
  as({ userId: user }, (q) => q<{ id: string }>("select public.issue_portal_link($1,$2,$3) as id", [contract, tokenHash, expires])).then((r) => r.rows[0].id);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500039001");
  sup = await createUser("966500039002");
  restricted = await createUser("966500039003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org R3') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'supervisor')", [org, sup, restricted]);
    client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
  });
  // quotes.manage, but limited to assigned projects (none)
  await asAdmin((q) => q("update public.memberships set permission_overrides = '{\"grant\":[\"quotes.manage\"]}', project_scope = 'assigned' where organization_id = $1 and user_id = $2", [org, restricted]));
});
afterAll(closePool);

describe("#5 issue_portal_link: one step, one active link", () => {
  it("two calls in a row leave exactly one active link — the newest", async () => {
    const c = await makeContract();
    const h1 = newHash();
    const h2 = newHash();
    const first = await issue(owner, c.id, h1);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    const second = await issue(owner, c.id, h2);
    const open = await openLinks(c.id);
    expect(open).toEqual([{ id: second, token_hash: h2 }]);
    // the floor trigger still sets the expiry (at least the planned end + warranty)
    const exp = await asAdmin((q) => q<{ e: Date }>("select expires_at as e from public.client_portal_links where id = $1", [second]));
    expect(new Date(exp.rows[0].e).getTime()).toBeGreaterThan(Date.now() + 150 * 86_400_000);
  });

  it("needs quotes.manage and access to the project; bad input refused", async () => {
    const c = await makeContract();
    const viewerOnly = await createUser("966500039004");
    await asAdmin((q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewerOnly]));
    await expectDenied(issue(viewerOnly, c.id), /not allowed/);
    await expectDenied(issue(restricted, c.id), /not allowed/);
    await expectDenied(issue(owner, c.id, "not-a-hash"), /invalid/);
    await expectDenied(issue(owner, c.id, newHash(), new Date(Date.now() + 4 * 365 * 86_400_000).toISOString()), /invalid/);
    expect((await openLinks(c.id)).length).toBe(1);
    await expect(issue(owner, c.id)).resolves.toBeTruthy();
  });

  it("refused once the warranty has ended — the current link stays as it was", async () => {
    const c = await makeContract({ start: "2025-01-01", warranty: 1, accept: true });
    const before = await openLinks(c.id);
    expect(before.length).toBe(1);
    await asAdmin((q) => q("update public.project_stages set status = 'confirmed', confirmed_at = now() - interval '3 months' where contract_id = $1 and is_final", [c.id]));
    await expectDenied(issue(owner, c.id), /warranty_ended/);
    expect(await openLinks(c.id)).toEqual(before);
  });

  it("a cancelled contract gets no link", async () => {
    const c = await makeContract();
    await as({ userId: owner }, (q) => q("update public.contracts set status = 'cancelled' where id = $1", [c.id]));
    await expectDenied(issue(owner, c.id), /invalid/);
  });
});

describe("#4 Qoyod petty cash: routed when queued; one reconciliation keeps Qoyod's cash account = the real petty-cash balance", () => {
  type Job = { id: string; kind: string; entity_type: string; ref: string; amount: string; route: string | null; cash_account_id: number | null; from_account_id: number | null; to_account_id: number | null; status: string; entry_kind: string | null };
  // each scenario in its own organization: one holder, Qoyod on, bank (receive) account 8
  async function setup(name: string, cash: number | null) {
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
    const o = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization($1) as id", [name])).rows[0].id);
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
    const acc = await as({ userId: owner }, async (q) => {
      await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [o, sup]);
      await q("insert into public.qoyod_settings (organization_id, enabled, receive_account_id, cash_account_id) values ($1, true, 8, $2)", [o, cash]);
      return (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة المشرف') returning id", [o, sup])).rows[0].id;
    });
    const entry = (kind: "topup" | "return" | "expense", amount: number) =>
      as({ userId: kind === "expense" ? sup : owner }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,$3,$4,'x')", [o, acc, kind, amount]));
    const set = (sql: string, args: unknown[] = []) => as({ userId: owner }, (q) => q(`update public.qoyod_settings set ${sql} where organization_id = $1`, [o, ...args]));
    const setCash = (v: number | null) => set("cash_account_id = $2", [v]);
    const jobs = () =>
      asAdmin((q) => q<Job>(
        `select j.id, j.kind, j.entity_type, j.ref, j.amount, j.route, j.cash_account_id, j.from_account_id, j.to_account_id, j.status, e.kind as entry_kind
         from public.qoyod_sync_jobs j left join public.petty_cash_entries e on e.id = j.entity_id
         where j.organization_id = $1 and j.entity_type in ('petty_cash', 'petty_cash_opening') order by j.created_at, j.ref`, [o])).then((r) => r.rows);
    const reconciles = async () => (await jobs()).filter((j) => j.entity_type === "petty_cash_opening");
    // the worker posted every job queued so far (they can no longer be withdrawn)
    const postAll = () => asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'done', attempts = 1, done_at = now() where organization_id = $1", [o]));
    // the real petty-cash balance (the ledger)
    const real = async () =>
      Number((await asAdmin((q) => q<{ p: string }>("select coalesce(sum(case when kind = 'topup' then amount else -amount end), 0) as p from public.petty_cash_entries where organization_id = $1", [o]))).rows[0].p);
    // what each Qoyod cash account ends up holding for petty cash once every job has posted:
    // cash-routed jobs on the account they were queued with + reconciles in − reconciles out (null = the bank)
    const qoyodCash = async () => {
      const held = new Map<number, number>();
      const add = (acct: number | null, a: number) => { if (acct != null) held.set(acct, Math.round(((held.get(acct) ?? 0) + a) * 100) / 100); };
      for (const j of await jobs()) {
        const a = Number(j.amount);
        if (j.entity_type === "petty_cash_opening") { add(j.to_account_id, a); add(j.from_account_id, -a); continue; }
        if (j.route !== "cash" || j.kind === "bill") continue;
        add(j.cash_account_id, j.kind === "transfer" && j.entry_kind === "topup" ? a : -a);
      }
      return Object.fromEntries([...held].filter(([, v]) => v !== 0));
    };
    return { o, entry, set, setCash, jobs, reconciles, postAll, real, qoyodCash };
  }
  const move = (j: Job) => ({ from: j.from_account_id, to: j.to_account_id, amount: j.amount });

  it("715: jobs queued without a cash account, then one chosen → one reconcile bank → cash 715 (not 1430)", async () => {
    const t = await setup("Org R3 petty A", null);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    expect((await t.jobs()).map((j) => [j.kind, j.route, j.cash_account_id])).toEqual([["transfer", "bank", null], ["transfer", "bank", null], ["bill", null, null], ["bill_payment", "bank", null]]);
    await t.setCash(7);
    const r = await t.reconciles();
    expect(r.map(move)).toEqual([{ from: null, to: 7, amount: "715.00" }]);
    expect(r[0].ref.startsWith("pco:")).toBe(true);
    // the queued jobs keep their route — choosing the account later doesn't re-route them
    expect((await t.jobs()).filter((j) => j.entity_type === "petty_cash").map((j) => j.route)).toEqual(["bank", "bank", null, "bank"]);
    expect(await t.qoyodCash()).toEqual({ 7: 715 });
    expect(await t.real()).toBe(715);
  });

  it("cash account chosen first → every job routed to it, no reconcile", async () => {
    const t = await setup("Org R3 petty B", 7);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    expect((await t.jobs()).map((j) => [j.route, j.cash_account_id])).toEqual([["cash", 7], ["cash", 7], [null, null], ["cash", 7]]);
    expect(await t.reconciles()).toEqual([]);
    expect(await t.qoyodCash()).toEqual({ 7: 715 });
  });

  it("mixed: top-up before the cash account, return and expense after → reconcile 1000", async () => {
    const t = await setup("Org R3 petty C", null);
    await t.entry("topup", 1000);
    await t.setCash(7);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "1000.00" }]);
    expect(await t.qoyodCash()).toEqual({ 7: 715 });
  });

  it("A: cleared (after posting) → back to the bank; spent from the bank; chosen again → only what is really there", async () => {
    const t = await setup("Org R3 petty RA", null);
    await t.entry("topup", 1000);
    await t.entry("expense", 300);
    await t.setCash(7);
    await t.postAll();
    await t.setCash(null);
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "700.00" }, { from: 7, to: null, amount: "700.00" }]);
    expect(await t.qoyodCash()).toEqual({});
    await t.entry("expense", 200);
    await t.postAll();
    await t.setCash(7);
    expect((await t.reconciles()).map(move).slice(2)).toEqual([{ from: null, to: 7, amount: "500.00" }]);
    expect(await t.qoyodCash()).toEqual({ 7: 500 });
    expect(await t.real()).toBe(500);
  });

  it("A': cleared before the worker ran → the queued reconcile is withdrawn, not reversed", async () => {
    const t = await setup("Org R3 petty RA2", null);
    await t.entry("topup", 1000);
    await t.entry("expense", 300);
    await t.setCash(7);
    await t.setCash(null);
    expect(await t.reconciles()).toEqual([]);
    await t.entry("expense", 200);
    await t.setCash(7);
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "500.00" }]);
    expect(await t.qoyodCash()).toEqual({ 7: 500 });
  });

  it("B: cash account chosen while sending was off → reconciled when sending is switched on", async () => {
    const t = await setup("Org R3 petty RB", null);
    await t.entry("topup", 1000);
    await t.set("enabled = false");
    await t.setCash(7);
    expect(await t.reconciles()).toEqual([]);
    await t.set("enabled = true");
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "1000.00" }]);
    await t.entry("expense", 100);
    expect(await t.qoyodCash()).toEqual({ 7: 900 });
    expect(await t.real()).toBe(900);
  });

  it("C: the bank account can't be the cash account (DB) — routing stays as it was", async () => {
    const t = await setup("Org R3 petty RC", 7);
    await t.entry("topup", 1000);
    await expectDenied(t.set("receive_account_id = 7"), /qoyod_settings_cash_not_bank/);
    await expectDenied(t.setCash(8), /qoyod_settings_cash_not_bank/);
    await t.entry("topup", 500);
    await t.set("receive_account_id = 10");
    expect(await t.reconciles()).toEqual([]);
    expect(await t.qoyodCash()).toEqual({ 7: 1500 });
  });

  it("D: cash account 7 → 9 after posting → one journal moves 7's holding to 9", async () => {
    const t = await setup("Org R3 petty RD", null);
    await t.entry("topup", 1000);
    await t.setCash(7);
    await t.entry("expense", 285);
    await t.postAll();
    await t.setCash(9);
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "1000.00" }, { from: 7, to: 9, amount: "715.00" }]);
    await t.entry("return", 15);
    expect(await t.qoyodCash()).toEqual({ 9: 700 });
    expect(await t.real()).toBe(700);
  });

  it("D': 7 → 9 before the worker ran → the queued reconcile is replaced by one straight to 9", async () => {
    const t = await setup("Org R3 petty RD2", null);
    await t.entry("topup", 1000);
    await t.setCash(7);
    await t.setCash(9);
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 9, amount: "1000.00" }]);
    expect(await t.qoyodCash()).toEqual({ 9: 1000 });
  });

  it("nothing changed → no new job (same account saved again, other settings, clear-and-rechoose after posting reverses exactly)", async () => {
    const t = await setup("Org R3 petty RE", null);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    await t.setCash(7);
    await t.postAll();
    await t.set("cash_account_id = 7, salary_account_id = 53");
    await t.set("receive_account_id = 8");
    await t.set("enabled = true");
    expect(await t.reconciles()).toHaveLength(1);
    // cleared and chosen again by the automatic setup (service role) before anything posted → nothing new
    await t.setCash(null);
    await as("service_role", (q) => q("update public.qoyod_settings set cash_account_id = 7 where organization_id = $1", [t.o]));
    expect(await t.reconciles()).toHaveLength(1);
    expect(await t.qoyodCash()).toEqual({ 7: 715 });
    // a top-up routed bank meanwhile → only that 100 moves
    await t.setCash(null);
    await t.entry("topup", 100);
    await t.setCash(7);
    expect((await t.reconciles()).map((j) => j.amount)).toEqual(["715.00", "100.00"]);
    expect(await t.qoyodCash()).toEqual({ 7: 815 });
    expect(await t.real()).toBe(815);
  });

  it("nothing open → no reconcile; a running / retried reconcile is never withdrawn", async () => {
    const t = await setup("Org R3 petty RF", null);
    await t.entry("topup", 500);
    await t.entry("expense", 500);
    await t.setCash(7);
    expect(await t.reconciles()).toEqual([]);
    await t.entry("topup", 50);
    await t.setCash(null);
    await t.setCash(9);
    await asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'running', attempts = 1 where organization_id = $1 and entity_type = 'petty_cash_opening'", [t.o]));
    await t.setCash(null);
    // the top-up was routed to 7 → 7 → 9 (claimed by the worker: kept), then 9 → the bank
    expect((await t.reconciles()).map(move)).toEqual([{ from: 7, to: 9, amount: "50.00" }, { from: 9, to: null, amount: "50.00" }]);
    expect(await t.qoyodCash()).toEqual({});
  });

  it("a reconcile the worker already tried is never withdrawn, even after a retry resets its attempts", async () => {
    const t = await setup("Org R3 petty RT", null);
    await t.entry("topup", 300);
    await t.setCash(7);
    // the worker claimed it (it may have reached Qoyod), it failed, then «إعادة المحاولة» reset it
    await asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'running', attempts = 1 where organization_id = $1 and entity_type = 'petty_cash_opening'", [t.o]));
    await asAdmin((q) => q("update public.qoyod_sync_jobs set status = 'queued', attempts = 0, last_error = null where organization_id = $1 and entity_type = 'petty_cash_opening'", [t.o]));
    await t.setCash(null);
    // kept (bank → 7) and reversed (7 → bank) — not withdrawn
    expect((await t.reconciles()).map(move)).toEqual([{ from: null, to: 7, amount: "300.00" }, { from: 7, to: null, amount: "300.00" }]);
  });

  it("a job's route and accounts are set by the database, not by whoever inserts it", async () => {
    const t = await setup("Org R3 petty G", null);
    const e = (await asAdmin((q) => q<{ id: string }>("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) select $1, id, 'topup', 10, 'x' from public.petty_cash_accounts where organization_id = $1 returning id", [t.o]))).rows[0].id;
    await asAdmin((q) => q("delete from public.qoyod_sync_jobs where organization_id = $1", [t.o]));
    await asAdmin((q) => q("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, amount, route, cash_account_id, from_account_id, to_account_id) values ($1,'transfer','petty_cash',$2,$3,10,'cash',4,4,5)", [t.o, e, "pct:" + e]));
    expect((await t.jobs()).map((j) => [j.route, j.cash_account_id, j.from_account_id, j.to_account_id])).toEqual([["bank", null, null, null]]);
    const other = await asAdmin((q) => q<{ route: string | null; cash_account_id: number | null }>("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, route, cash_account_id) values ($1,'customer','client',$1,'x','cash',4) returning route, cash_account_id", [t.o]));
    expect(other.rows[0]).toEqual({ route: null, cash_account_id: null });
  });
});
