import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, viewer: string, supervisor: string;
let org: string, orgB: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000501");
  ownerB = await createUser("966500000502");
  viewer = await createUser("966500000503");
  supervisor = await createUser("966500000504");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, (q) =>
    q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer'),($1,$3,'supervisor')", [org, viewer, supervisor]),
  );
});
afterAll(closePool);

const year = new Date().getFullYear();
let client: string, survey: string, quote: string;

describe("clients and surveys", () => {
  it("numbers clients and surveys per organization and year", async () => {
    const r = await as({ userId: owner }, async (q) => {
      const c = await q<{ id: string; number: string }>("insert into public.clients (organization_id, name, phone) values ($1, 'أبو محمد', '966551234567') returning id, number", [org]);
      const c2 = await q<{ number: string }>("insert into public.clients (organization_id, name) values ($1, 'شركة البناء') returning number", [org]);
      const s = await q<{ id: string; number: string }>("insert into public.surveys (organization_id, client_id, mode) values ($1, $2, 'rooms') returning id, number", [org, c.rows[0].id]);
      return { c: c.rows[0], c2: c2.rows[0].number, s: s.rows[0] };
    });
    client = r.c.id;
    survey = r.s.id;
    expect(r.c.number).toBe(`CL-${year}-001`);
    expect(r.c2).toBe(`CL-${year}-002`);
    expect(r.s.number).toBe(`SV-${year}-001`);
  });

  it("rejects bad data and number changes", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.clients (organization_id, name, phone) values ($1, 'x y', '05-55')", [org])));
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.clients (organization_id, name, location_url) values ($1, 'x y', 'javascript:alert(1)')", [org])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.clients set number = 'CL-1' where id = $1", [client])), /cannot change/);
  });

  it("stores rooms with what applies in each", async () => {
    const r = await as({ userId: owner }, (q) =>
      q("insert into public.survey_rooms (organization_id, survey_id, name, length_m, width_m, height_m, gypsum_ceiling, ceiling_board, wall_zone) values ($1,$2,'مطبخ',5,4,3,true,'fire','wet') returning id", [org, survey]),
    );
    expect(r.rowCount).toBe(1);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.survey_rooms (organization_id, survey_id, name, length_m, width_m) values ($1,$2,'x',0,4)", [org, survey])));
  });

  it("viewers read, only managers write; other organizations see nothing", async () => {
    const v = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.clients"));
    expect(v.rows[0].n).toBe(2);
    await expectDenied(as({ userId: viewer }, (q) => q("insert into public.clients (organization_id, name) values ($1, 'x y')", [org])));
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.clients) + (select count(*)::int from public.surveys) + (select count(*)::int from public.survey_rooms) as n"));
    expect(b.rows[0].n).toBe(0);
    await expectDenied(
      as({ userId: ownerB }, (q) => q("insert into public.surveys (organization_id, client_id) values ($1, $2)", [orgB, client])),
      /another organization/,
    );
  });
});

describe("quotes and versions", () => {
  it("numbers quotes and assigns versions 1, 2, 3 automatically", async () => {
    quote = await as({ userId: supervisor }, async (q) => {
      const r = await q<{ id: string; number: string }>("insert into public.quotes (organization_id, client_id, survey_id, service) values ($1,$2,$3,'interior') returning id, number", [org, client, survey]);
      expect(r.rows[0].number).toBe(`Q-${year}-001`);
      return r.rows[0].id;
    });
    const versions = await as({ userId: supervisor }, async (q) => {
      const out: number[] = [];
      for (let i = 0; i < 3; i++) {
        const v = await q<{ version: number }>(
          "insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,99,'{}','{}','{}',1000,1000) returning version",
          [org, quote],
        );
        out.push(v.rows[0].version);
      }
      return out;
    });
    expect(versions).toEqual([1, 2, 3]);
    const cur = await as({ userId: owner }, (q) => q("select current_version from public.quotes where id = $1", [quote]));
    expect(cur.rows[0].current_version).toBe(3);
  });

  it("keeps versions append-only", async () => {
    const u = await as({ userId: owner }, (q) => q("update public.quote_versions set total = 1").catch((e) => e));
    expect(String(u.message ?? "")).toMatch(/permission denied/);
    const d = await as({ userId: owner }, (q) => q("delete from public.quote_versions").catch((e) => e));
    expect(String(d.message ?? "")).toMatch(/permission denied/);
  });

  it("hides internal costs from users without costs.view", async () => {
    await as({ userId: owner }, async (q) => {
      const v = (await q<{ id: string }>("select id from public.quote_versions where quote_id = $1 and version = 3", [quote])).rows[0].id;
      await q("insert into public.quote_version_costs (quote_version_id, organization_id, cost, cost_with_contingency, margin_percent, lines) values ($1,$2,700,735,26.5,'[]')", [v, org]);
    });
    await as({ userId: owner }, (q) => q(`update public.memberships set permission_overrides = '{"grant":["quotes.view"],"deny":[]}' where user_id = $1`, [viewer]));
    const seen = await as({ userId: viewer }, (q) => q("select (select count(*)::int from public.quote_versions) as v, (select count(*)::int from public.quote_version_costs) as c"));
    expect(seen.rows[0]).toEqual({ v: 3, c: 0 });
    const own = await as({ userId: owner }, (q) => q("select margin_percent from public.quote_version_costs"));
    expect(own.rows[0].margin_percent).toBe("26.50");
  });

  it("approvals: requested as pending, decided only by approvers, decision stamped", async () => {
    const id = await as({ userId: supervisor }, async (q) =>
      (await q<{ id: string }>("insert into public.approvals (organization_id, kind, entity, entity_id, details) values ($1,'quote_margin','quote',$2,'{\"margin\":15}') returning id", [org, quote])).rows[0].id,
    );
    await expectDenied(as({ userId: supervisor }, (q) => q("insert into public.approvals (organization_id, kind, entity, entity_id, status) values ($1,'quote_margin','quote',$2,'approved')", [org, quote])));
    const s = await as({ userId: supervisor }, (q) => q("update public.approvals set status = 'approved' where id = $1 returning id", [id]));
    expect(s.rowCount).toBe(0);
    await expectDenied(as({ userId: owner }, (q) => q("update public.approvals set details = '{}' where id = $1", [id])), /decision/);
    const ok = await as({ userId: owner }, (q) => q<{ decided_by: string; decided_at: string }>("update public.approvals set status = 'approved' where id = $1 returning decided_by, decided_at", [id]));
    expect(ok.rows[0].decided_by).toBe(owner);
    expect(ok.rows[0].decided_at).toBeTruthy();
  });

  it("isolates quotes between organizations", async () => {
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.quotes) + (select count(*)::int from public.quote_versions) + (select count(*)::int from public.approvals) as n"));
    expect(b.rows[0].n).toBe(0);
    await expectDenied(
      as({ userId: ownerB }, (q) => q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [orgB, quote])),
    );
  });
});
