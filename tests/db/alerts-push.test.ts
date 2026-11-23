import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, viewer: string, ownerB: string;
let org: string, orgB: string, contract: string;
const TOKEN = "tok_" + "a".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const C = `C-${year}-001`;
const P256 = "B" + "x".repeat(86);
const AUTH = "y".repeat(22);
const EP = "https://fcm.googleapis.com/fcm/send/abc123";

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500003001");
  viewer = await createUser("966500003002");
  ownerB = await createUser("966500003003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'أبو فهد','966511113333') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service, status) values ($1,$2,'gypsum','issued') returning id", [org, client])).rows[0].id;
    const v = (await q<{ id: string }>("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{}',11500,0,0,11500) returning id", [org, quote])).rows[0].id;
    await q(
      `insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines)
       values ($1,$2,3000,3150,28,'[{"group":"material","cost":1000},{"group":"labour","cost":2000}]')`,
      [v, org],
    );
    // delivery date = start + 1 day = 7 days ago
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',(now() at time zone 'Asia/Riyadh')::date - 8,1,11500,'sent') returning id", [org, quote, client])).rows[0].id;
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
  await as("service_role", (q) => q("select public.portal_accept($1,$2,'فهد',null,'1.1.1.1','x')", [C, TOKEN]));
  // last site visit 3 days ago; an expense of 12,000 recorded on the project
  await asAdmin(async (q) => {
    // the app stamps visits with the database clock; back-date one for the test (triggers off for this insert)
    await q("set local session_replication_role = replica");
    await q("insert into public.site_visits (organization_id, contract_id, checked_in_at) values ($1,$2, now() - interval '3 days')", [org, contract]);
    await q("set local session_replication_role = origin");
    const p = (await q<{ id: string }>("insert into public.purchases (organization_id, contract_id, status, subtotal, total, recorded_at) values ($1,$2,'recorded',12000,12000, now()) returning id", [org, contract])).rows[0].id;
    await q("insert into public.purchase_lines (organization_id, purchase_id, seq, kind, description, quantity, unit_price, amount) values ($1,$2,1,'expense','نقل',1,12000,12000)", [org, p]);
  });
});
afterAll(closePool);

const mine = (user: string) =>
  as({ userId: user }, (q) => q<{ kind: string; params: Record<string, unknown> }>("select kind, params from public.notifications order by kind")).then((r) => r.rows);

describe("project alerts", () => {
  it("the daily job raises delay, missed visit, over budget and losing alerts — once", async () => {
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    const list = await mine(owner);
    const kinds = list.map((n) => n.kind);
    expect(kinds.filter((k) => k === "project_delay")).toHaveLength(1);
    expect(kinds.filter((k) => k === "missed_visit")).toHaveLength(1);
    expect(kinds.filter((k) => k === "project_over_budget")).toHaveLength(1);
    expect(kinds.filter((k) => k === "project_losing")).toHaveLength(1);
    expect(list.find((n) => n.kind === "project_delay")?.params).toMatchObject({ number: C, days: 7, client: "أبو فهد" });
    expect(list.find((n) => n.kind === "missed_visit")?.params).toMatchObject({ days: 3 });
    expect(Number(list.find((n) => n.kind === "project_over_budget")?.params.percent)).toBe(1100);
    expect(Number(list.find((n) => n.kind === "project_losing")?.params.profit)).toBe(-500);
  });

  it("cost alerts reach only people who can see costs", async () => {
    const kinds = (await mine(viewer)).map((n) => n.kind);
    expect(kinds).toContain("project_delay");
    expect(kinds).not.toContain("project_over_budget");
    expect(kinds).not.toContain("project_losing");
    expect(await mine(ownerB)).toHaveLength(0);
  });
});

describe("push notifications", () => {
  it("a user registers their own device; only real push services are accepted", async () => {
    await as({ userId: owner }, (q) => q("insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4,$5)", [org, owner, EP, P256, AUTH]));
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1,$2,'https://evil.example.com/x',$3,$4)", [org, owner, P256, AUTH])));
    await expectDenied(as({ userId: viewer }, (q) => q("insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4,$5)", [org, owner, EP + "2", P256, AUTH])));
    await expectDenied(as({ userId: ownerB }, (q) => q("insert into public.push_subscriptions (organization_id, user_id, endpoint, p256dh, auth) values ($1,$2,$3,$4,$5)", [org, ownerB, EP + "3", P256, AUTH])));
    const seen = await as({ userId: viewer }, (q) => q("select id from public.push_subscriptions"));
    expect(seen.rows).toHaveLength(0);
    expect((await as({ userId: owner }, (q) => q("select id from public.push_subscriptions"))).rows).toHaveLength(1);
    await expectDenied(as({ userId: owner }, (q) => q("update public.push_subscriptions set endpoint = $1", [EP + "4"])));
  });

  it("new notifications queue a push for users with a device, unless they turned push off for that kind", async () => {
    await as({ userId: owner }, (q) => q("insert into public.notification_preferences (organization_id, user_id, kind, in_app, whatsapp, push) values ($1,$2,'approval',true,false,false)", [org, owner]));
    await asAdmin((q) => q("select private.notify($1,'projects.view','project_delay','{}'::jsonb,'/', 'x1')", [org]));
    await asAdmin((q) => q("select private.notify($1,'approvals.decide','approval','{}'::jsonb,'/', 'x2')", [org]));
    const d = await asAdmin((q) => q<{ channel: string; user_id: string; kind: string }>("select d.channel, d.user_id, n.kind from public.notification_deliveries d join public.notifications n on n.id = d.notification_id where d.channel = 'push'"));
    expect(d.rows.map((r) => r.kind)).toEqual(["project_delay"]);
    expect(d.rows[0].user_id).toBe(owner);
    await expectDenied(as({ userId: owner }, (q) => q("select id from public.notification_deliveries")));
  });

  it("the server key pair is reachable by the service role only", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("select public.push_vapid_keys()")));
    const first = await as("service_role", (q) => q<{ k: { public_key: string } }>("select public.push_vapid_keys($1,$2) as k", [P256, "z".repeat(43)]));
    const again = await as("service_role", (q) => q<{ k: { public_key: string } }>("select public.push_vapid_keys($1,$2) as k", ["C" + "x".repeat(86), "w".repeat(43)]));
    expect(again.rows[0].k.public_key).toBe(first.rows[0].k.public_key);
    void orgB;
  });
});
