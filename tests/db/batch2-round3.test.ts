import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, asServer, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * Review of batch 2, third round (Nov 2026):
 * #4 a cash account chosen later moves the open petty-cash balance bank → cash once (Qoyod) ·
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

describe("#4 Qoyod: petty cash routed when queued; a cash account chosen later moves only what sat in the bank", () => {
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
    const setCash = (v: number | null) => as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = $2 where organization_id = $1", [o, v]));
    const jobs = () =>
      asAdmin((q) => q<{ kind: string; entity_type: string; ref: string; amount: string; route: string | null; entry_kind: string | null }>(
        `select j.kind, j.entity_type, j.ref, j.amount, j.route, e.kind as entry_kind
         from public.qoyod_sync_jobs j left join public.petty_cash_entries e on e.id = j.entity_id
         where j.organization_id = $1 and j.entity_type in ('petty_cash', 'petty_cash_opening') order by j.created_at`, [o])).then((r) => r.rows);
    const openings = async () => (await jobs()).filter((j) => j.entity_type === "petty_cash_opening");
    // what Qoyod's cash account ends up holding once every job has posted: openings (bank → cash)
    // + the cash-routed jobs (top-ups in, returns and expense payments out); bank-routed ones post nothing to cash
    const qoyodCash = async () =>
      (await jobs()).reduce((sum, j) => {
        const a = Number(j.amount);
        if (j.entity_type === "petty_cash_opening") return sum + a;
        if (j.route !== "cash" || j.kind === "bill") return sum;
        return sum + (j.kind === "transfer" && j.entry_kind === "topup" ? a : -a);
      }, 0);
    return { o, entry, setCash, jobs, openings, qoyodCash };
  }

  it("reviewer's scenario: jobs queued without a cash account, then one chosen → opening 715, cash total 715 (not 1430)", async () => {
    const t = await setup("Org R3 petty A", null);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    // routed when queued: no cash account → bank (the expense's bill has no route)
    const routed = (await t.jobs()).map((j) => [j.kind, j.route]);
    expect(routed).toEqual([["transfer", "bank"], ["transfer", "bank"], ["bill", null], ["bill_payment", "bank"]]);
    await t.setCash(7);
    const op = await t.openings();
    expect(op).toHaveLength(1);
    expect(op[0]).toMatchObject({ kind: "transfer", amount: "715.00", route: "cash" });
    expect(op[0].ref.startsWith(`pco:${t.o}:`)).toBe(true);
    // the queued jobs keep their route — choosing the account later doesn't re-route them
    expect((await t.jobs()).filter((j) => j.entity_type === "petty_cash").map((j) => j.route)).toEqual(["bank", "bank", null, "bank"]);
    expect(await t.qoyodCash()).toBe(715);
  });

  it("cash account chosen first → every job routed cash, no opening; cash total 715", async () => {
    const t = await setup("Org R3 petty B", 7);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    expect((await t.jobs()).map((j) => j.route)).toEqual(["cash", "cash", null, "cash"]);
    expect(await t.openings()).toEqual([]);
    expect(await t.qoyodCash()).toBe(715);
  });

  it("mixed: top-up before the cash account, return and expense after → opening 1000, cash total 715", async () => {
    const t = await setup("Org R3 petty C", null);
    await t.entry("topup", 1000);
    await t.setCash(7);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    expect((await t.openings()).map((j) => j.amount)).toEqual(["1000.00"]);
    expect(await t.qoyodCash()).toBe(715);
  });

  it("cleared and chosen again moves only the difference (nothing if nothing changed)", async () => {
    const t = await setup("Org R3 petty D", null);
    await t.entry("topup", 1000);
    await t.entry("return", 200);
    await t.entry("expense", 85);
    await t.setCash(7);
    // saving the same account again, or switching one cash account for another, isn't a new switch
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 7, salary_account_id = 53 where organization_id = $1", [t.o]));
    await t.setCash(9);
    expect(await t.openings()).toHaveLength(1);
    // cleared and chosen again (the automatic setup writes as the service role) → nothing new to move
    await t.setCash(null);
    await as("service_role", (q) => q("update public.qoyod_settings set cash_account_id = 7 where organization_id = $1", [t.o]));
    expect(await t.openings()).toHaveLength(1);
    expect(await t.qoyodCash()).toBe(715);
    // cleared, a top-up routed bank meanwhile, chosen again → only that 100 moves
    await t.setCash(null);
    await t.entry("topup", 100);
    await t.setCash(7);
    expect((await t.openings()).map((j) => j.amount)).toEqual(["715.00", "100.00"]);
    expect(await t.qoyodCash()).toBe(815);
  });

  it("nothing open in the bank, or the cash account is the bank account → no opening", async () => {
    const t = await setup("Org R3 petty E", null);
    await t.entry("topup", 500);
    await t.setCash(8);
    expect(await t.openings()).toEqual([]);
    // cash = bank still routes bank
    await t.entry("expense", 500);
    expect((await t.jobs()).filter((j) => j.kind !== "bill").map((j) => j.route)).toEqual(["bank", "bank"]);
    await t.setCash(7);
    expect(await t.openings()).toEqual([]);
    expect(await t.qoyodCash()).toBe(0);
  });

  it("a job's route is set by the database, not by whoever inserts it", async () => {
    const t = await setup("Org R3 petty F", null);
    const e = (await asAdmin((q) => q<{ id: string }>("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) select $1, id, 'topup', 10, 'x' from public.petty_cash_accounts where organization_id = $1 returning id", [t.o]))).rows[0].id;
    await asAdmin((q) => q("delete from public.qoyod_sync_jobs where organization_id = $1", [t.o]));
    await asAdmin((q) => q("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, amount, route) values ($1,'transfer','petty_cash',$2,$3,10,'cash')", [t.o, e, "pct:" + e]));
    expect((await t.jobs()).map((j) => j.route)).toEqual(["bank"]);
    // other jobs carry no route
    const other = await asAdmin((q) => q<{ route: string | null }>("insert into public.qoyod_sync_jobs (organization_id, kind, entity_type, entity_id, ref, route) values ($1,'customer','client',$1,'x','cash') returning route", [t.o]));
    expect(other.rows[0].route).toBeNull();
  });
});
