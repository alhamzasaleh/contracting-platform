import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asServer, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, viewer: string;
let org: string, contract: string;
const TOKEN = "tok_" + "n".repeat(40);
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const year = new Date().getFullYear();
const mine = (userId: string, kind: string) =>
  as({ userId }, (q) => q<{ n: number }>("select count(*)::int as n from public.notifications where kind = $1", [kind])).then((r) => r.rows[0].n);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001401");
  supervisor = await createUser("966500001402");
  viewer = await createUser("966500001403");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor'),($1,$3,'viewer')", [org, supervisor, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, phone, name) values ($1,'966500008888','عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await asServer(q, "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1000,1000)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total, status) values ($1,$2,1,$3,'gypsum',current_date,10,1000,'sent') returning id", [org, quote, client])).rows[0].id;
    // a contract always has its payment schedule (create_contract); "custom" = never requested by an event
    await q("insert into public.contract_payments (organization_id, contract_id, seq, label, percent, amount, due_event) values ($1,$2,1,'كامل',100,1000,'custom')", [org, contract]);
    await q("insert into public.client_portal_links (organization_id, contract_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '30 days')", [org, contract, hash(TOKEN)]);
  });
});
afterAll(closePool);

describe("notifications", () => {
  it("client acceptance notifies everyone who can see contracts", async () => {
    await as("service_role", (q) => q("select public.portal_accept($1,$2,'محمد',null,'1.1.1.1','x')", [`C-${year}-001`, TOKEN]));
    expect(await mine(owner, "contract_accepted")).toBe(1);
    expect(await mine(supervisor, "contract_accepted")).toBe(1);
  });

  it("a client note reaches project managers, not viewers", async () => {
    await as("service_role", (q) => q("select public.portal_add_note($1,$2,null,'ملاحظة',$3)", [`C-${year}-001`, TOKEN, []]));
    expect(await mine(supervisor, "client_note")).toBe(1);
    expect(await mine(viewer, "client_note")).toBe(0);
  });

  it("approvals go to whoever decides them", async () => {
    await as({ userId: supervisor }, (q) =>
      q("insert into public.addenda (organization_id, contract_id, title, description, amount, total) values ($1,$2,'إضافي','وصف العمل',500,500) returning id", [org, contract]).then((r) =>
        q("select public.submit_addendum($1)", [r.rows[0].id]),
      ),
    );
    expect(await mine(owner, "approval")).toBe(1);
    expect(await mine(supervisor, "approval")).toBe(0);
  });

  it("preferences: switching off in-app stops new ones", async () => {
    await as({ userId: supervisor }, (q) => q("insert into public.notification_preferences (organization_id, user_id, kind, in_app) values ($1,$2,'client_note',false)", [org, supervisor]));
    await as("service_role", (q) => q("select public.portal_add_note($1,$2,null,'ملاحظة ثانية',$3)", [`C-${year}-001`, TOKEN, []]));
    expect(await mine(supervisor, "client_note")).toBe(1);
    expect(await mine(owner, "client_note")).toBe(2);
  });

  it("users read and mark only their own; nobody writes notifications directly", async () => {
    const other = await as({ userId: supervisor }, (q) => q("update public.notifications set read_at = now() where user_id = $1 returning id", [owner]));
    expect(other.rowCount).toBe(0);
    const own = await as({ userId: owner }, (q) => q("update public.notifications set read_at = now() where user_id = $1 returning id", [owner]));
    expect(own.rowCount).toBeGreaterThan(0);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.notifications (organization_id, user_id, kind) values ($1,$2,'approval')", [org, owner])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.notifications set kind = 'doc_expiry'")));
    await expectDenied(as({ userId: owner }, (q) => q("select * from public.notification_deliveries")));
  });

  it("daily reminders run only from the server and don't repeat", async () => {
    await asAdmin((q) => q("insert into public.employees (organization_id, phone, full_name, id_expiry) values ($1,'966500009999','أحمد', (now() at time zone 'Asia/Riyadh')::date + 30)", [org]));
    await expectDenied(as({ userId: owner }, (q) => q("select public.run_daily_reminders()")));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    await as("service_role", (q) => q("select public.run_daily_reminders()"));
    expect(await mine(owner, "doc_expiry")).toBe(1);
    expect(await mine(supervisor, "doc_expiry")).toBe(0);
  });
});
