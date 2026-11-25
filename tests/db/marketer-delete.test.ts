import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase, type Q } from "./db";

/**
 * Deleting a success partner (owner, Nov 2026): the owner only, through public.delete_marketer,
 * and only a partner no quote, priced version, contract or reward points at (added by mistake).
 * Clients that named him («جاء عنطريق») lose the link; his page links go with him.
 */
let owner: string, manager: string, other: string, org: string, orgB: string, client: string;
const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const newPartner = (q: Q, o = org) =>
  q<{ id: string }>("insert into public.marketers (organization_id, name, commission_percent) values ($1,'شريك للحذف',5) returning id", [o]).then((r) => r.rows[0].id);
const del = (u: string, id: string) => as({ userId: u }, (q) => q("select public.delete_marketer($1)", [id]));
const exists = (id: string) => asAdmin((q) => q("select 1 from public.marketers where id = $1", [id])).then((r) => r.rowCount === 1);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500012001");
  manager = await createUser("966500012002");
  other = await createUser("966500012003");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: other }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await asAdmin((q) =>
    q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'finance','{"grant":["marketers.manage"]}')`, [org, manager]),
  );
  client = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'أبو سالم','966511113333') returning id", [org])).rows[0].id);
});
afterAll(closePool);

describe("delete_marketer", () => {
  it("only the owner — not a member with marketers.manage, not another organization, never a direct DELETE", async () => {
    const id = await as({ userId: owner }, (q) => newPartner(q));
    await expectDenied(del(manager, id), /not allowed/);
    await expectDenied(del(other, id), /not allowed/);
    await expectDenied(as({ userId: owner }, (q) => q("delete from public.marketers where id = $1", [id])), /permission denied/);
    await expectDenied(del(owner, "00000000-0000-0000-0000-000000000000"), /not allowed/);
    const b = await as({ userId: other }, (q) => newPartner(q, orgB));
    await expectDenied(del(owner, b), /not allowed/);
    expect(await exists(id)).toBe(true);
    expect(await exists(b)).toBe(true);
  });

  it("an unused partner goes; his clients lose «جاء عن طريق», his page links go, the audit log keeps the row", async () => {
    const id = await as({ userId: owner }, (q) => newPartner(q));
    await as({ userId: owner }, async (q) => {
      await q("update public.clients set marketer_id = $1 where id = $2", [id, client]);
      await q("select public.issue_marketer_link($1, $2)", [id, hash("tok-del-1")]);
    });
    await del(owner, id);
    expect(await exists(id)).toBe(false);
    const c = await asAdmin((q) => q<{ marketer_id: string | null }>("select marketer_id from public.clients where id = $1", [client]));
    expect(c.rows[0].marketer_id).toBeNull();
    expect((await asAdmin((q) => q("select 1 from public.marketer_portal_links where marketer_id = $1", [id]))).rowCount).toBe(0);
    const audit = await asAdmin((q) => q<{ actor_id: string }>("select actor_id from public.audit_log where table_name = 'marketers' and record_id = $1 and action = 'delete'", [id]));
    expect(audit.rows[0]?.actor_id).toBe(owner);
  });

  it("a partner a quote or priced version points at stays", async () => {
    const id = await as({ userId: owner }, (q) => newPartner(q));
    await asAdmin(async (q) => {
      const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
      const v = (await q<{ id: string }>("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, vat_percent, vat, total) values ($1,$2,1,'{}','{}','{\"workTypes\":[]}',1000,0,0,1000) returning id", [org, quote])).rows[0].id;
      await q("insert into public.quote_version_costs (organization_id, quote_version_id, cost, cost_with_contingency, margin_percent, lines, purchase_list, marketer_id, commission_percent, commission_amount) values ($1,$2,500,525,30,'[]','[]',$3,5,50)", [org, v, id]);
    });
    await expectDenied(del(owner, id), /partner has records/);
    expect(await exists(id)).toBe(true);
  });
});
