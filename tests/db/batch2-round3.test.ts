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

describe("#4 Qoyod: a cash account chosen later moves the open petty-cash balance once", () => {
  it("one opening transfer bank → cash for the open balance; skipped top-ups stay; idempotent per switch", async () => {
    const accounts = await as({ userId: owner }, async (q) => {
      const a = (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة المشرف') returning id", [org, sup])).rows[0].id;
      const b = (await q<{ id: string }>("insert into public.petty_cash_accounts (organization_id, holder_id, name) values ($1,$2,'عهدة المالك') returning id", [org, owner])).rows[0].id;
      return { a, b };
    });
    await as({ userId: owner }, (q) => q("insert into public.qoyod_settings (organization_id, enabled, receive_account_id) values ($1, true, 8)", [org]));
    await as({ userId: owner }, async (q) => {
      await q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'topup',1000,'تعبئة')", [org, accounts.a]);
      await q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'return',200,'استرجاع')", [org, accounts.a]);
      await q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'topup',300,'تعبئة')", [org, accounts.b]);
    });
    await as({ userId: sup }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'expense',85,'شريط')", [org, accounts.a]));
    // an inactive holder's balance isn't open petty cash
    await as({ userId: owner }, (q) => q("update public.petty_cash_accounts set is_active = false where id = $1", [accounts.b]));
    const opening = () =>
      asAdmin((q) => q<{ kind: string; ref: string; amount: string; entity_id: string }>("select kind, ref, amount, entity_id from public.qoyod_sync_jobs where organization_id = $1 and entity_type = 'petty_cash_opening' order by created_at", [org])).then((r) => r.rows);
    const transfers = () => asAdmin((q) => q<{ n: string }>("select count(*) as n from public.qoyod_sync_jobs where organization_id = $1 and entity_type = 'petty_cash'", [org])).then((r) => Number(r.rows[0].n));
    const before = await transfers();
    expect(await opening()).toEqual([]);

    // the owner picks a cash account in Settings → one opening job for 1000 − 200 − 85 = 715
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 7 where organization_id = $1", [org]));
    const jobs = await opening();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "transfer", amount: "715.00", entity_id: org });
    expect(jobs[0].ref.startsWith(`pco:${org}:`)).toBe(true);
    // earlier top-ups' jobs are left as they are (no new ones)
    expect(await transfers()).toBe(before);

    // saving other settings, or the same cash account again, adds nothing
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 7, salary_account_id = 53 where organization_id = $1", [org]));
    // changing from one cash account to another isn't a "chosen later" switch
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 9 where organization_id = $1", [org]));
    expect(await opening()).toHaveLength(1);

    // cleared and chosen again (the automatic setup writes as the service role) → a new switch, a new job
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = null where organization_id = $1", [org]));
    await as("service_role", (q) => q("update public.qoyod_settings set cash_account_id = 7 where organization_id = $1", [org]));
    expect(await opening()).toHaveLength(2);
  });

  it("no open balance, or the cash account is the bank account → nothing to move", async () => {
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = null where organization_id = $1", [org]));
    const count = () => asAdmin((q) => q<{ n: string }>("select count(*) as n from public.qoyod_sync_jobs where organization_id = $1 and entity_type = 'petty_cash_opening'", [org])).then((r) => Number(r.rows[0].n));
    const n0 = await count();
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 8 where organization_id = $1", [org]));
    expect(await count()).toBe(n0);
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = null where organization_id = $1", [org]));
    // spend the whole open balance (715)
    const a = (await asAdmin((q) => q<{ id: string }>("select id from public.petty_cash_accounts where organization_id = $1 and is_active", [org]))).rows[0].id;
    await as({ userId: sup }, (q) => q("insert into public.petty_cash_entries (organization_id, account_id, kind, amount, description) values ($1,$2,'expense',715,'مواد')", [org, a]));
    await as({ userId: owner }, (q) => q("update public.qoyod_settings set cash_account_id = 7 where organization_id = $1", [org]));
    expect(await count()).toBe(n0);
  });
});
