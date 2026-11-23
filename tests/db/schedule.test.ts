import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, viewer: string;
let org: string, orgB: string, contract: string, team: string, employee: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000701");
  ownerB = await createUser("966500000702");
  viewer = await createUser("966500000703");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    const quote = (await q<{ id: string }>("insert into public.quotes (organization_id, client_id, service) values ($1,$2,'gypsum') returning id", [org, client])).rows[0].id;
    await q("insert into public.quote_versions (organization_id, quote_id, version, selection, quantities, client_view, subtotal, total) values ($1,$2,1,'{}','{}','{}',1,1)", [org, quote]);
    await q("select public.issue_quote($1, null)", [quote]);
    contract = (await q<{ id: string }>("insert into public.contracts (organization_id, quote_id, quote_version, client_id, service, start_date, duration_days, total) values ($1,$2,1,$3,'gypsum','2026-12-01',10,1) returning id", [org, quote, client])).rows[0].id;
    employee = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, job_title, basic_salary) values ($1,'أحمد','مركب جبس',3000) returning id", [org])).rows[0].id;
  });
});
afterAll(closePool);

describe("scheduling", () => {
  it("owner creates a team with members and books it on a contract", async () => {
    team = await as({ userId: owner }, async (q) => {
      const t = (await q<{ id: string }>("insert into public.teams (organization_id, name, services) values ($1,'فريق الجبس','{gypsum}') returning id", [org])).rows[0].id;
      await q("insert into public.team_members (organization_id, team_id, employee_id) values ($1,$2,$3)", [org, t, employee]);
      await q("insert into public.schedule_entries (organization_id, team_id, contract_id, start_date, end_date) values ($1,$2,$3,'2026-12-01','2026-12-10')", [org, t, contract]);
      return t;
    });
    expect(team).toBeTruthy();
  });

  it("rejects bad spans and work without a contract", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.schedule_entries (organization_id, team_id, contract_id, start_date, end_date) values ($1,$2,$3,'2026-12-10','2026-12-01')", [org, team, contract])));
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.schedule_entries (organization_id, team_id, kind, start_date, end_date) values ($1,$2,'work','2026-12-01','2026-12-02')", [org, team])));
    await as({ userId: owner }, (q) => q("insert into public.schedule_entries (organization_id, team_id, kind, title, start_date, end_date) values ($1,$2,'leave','إجازة','2026-12-20','2026-12-22')", [org, team]));
  });

  it("is isolated between organizations, including references", async () => {
    const b = await as({ userId: ownerB }, (q) => q("select (select count(*)::int from public.teams) + (select count(*)::int from public.schedule_entries) + (select count(*)::int from public.team_members) as n"));
    expect(b.rows[0].n).toBe(0);
    const bTeam = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("insert into public.teams (organization_id, name) values ($1,'فريق ب') returning id", [orgB])).rows[0].id);
    await expectDenied(
      as({ userId: ownerB }, (q) => q("insert into public.schedule_entries (organization_id, team_id, contract_id, start_date, end_date) values ($1,$2,$3,'2026-12-01','2026-12-02')", [orgB, bTeam, contract])),
      /another organization/,
    );
    await expectDenied(as({ userId: ownerB }, (q) => q("insert into public.team_members (organization_id, team_id, employee_id) values ($1,$2,$3)", [orgB, bTeam, employee])), /another organization/);
    const roster = await as({ userId: ownerB }, (q) => q("select * from public.schedule_roster($1)", [org]));
    expect(roster.rowCount).toBe(0);
  });

  it("viewers see the schedule and names, but can't change it or read salaries", async () => {
    const seen = await as({ userId: viewer }, (q) => q("select count(*)::int as n from public.schedule_entries"));
    expect(seen.rows[0].n).toBe(2);
    const roster = await as({ userId: viewer }, (q) => q<{ full_name: string }>("select * from public.schedule_roster($1)", [org]));
    expect(roster.rows.map((r) => r.full_name)).toEqual(["أحمد"]);
    expect(Object.keys(roster.rows[0])).not.toContain("basic_salary");
    const emp = await as({ userId: viewer }, (q) => q("select basic_salary from public.employees"));
    expect(emp.rowCount).toBe(0);
    const upd = await as({ userId: viewer }, (q) => q("update public.schedule_entries set notes = 'x' returning id"));
    expect(upd.rowCount).toBe(0);
    await expectDenied(as({ userId: viewer }, (q) => q("insert into public.teams (organization_id, name) values ($1,'x y')", [org])));
  });

  it("anon sees nothing", async () => {
    await expectDenied(as("anon", (q) => q("select * from public.schedule_entries")));
    await expectDenied(as("anon", (q) => q("select * from public.schedule_roster($1)", [org])));
  });
});
