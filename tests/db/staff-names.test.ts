import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, resetDatabase } from "./db";

/*
 * Staff names (owner, Nov 2026): the maintenance assignee and the petty-cash holder show the linked
 * employee's «name · job». public.staff_employee_names(org) gives only (user_id, full_name, job_title)
 * of employees linked to members of the organization, to whoever can open those pages
 * (projects.view → /maintenance, purchases.view → /purchases/petty-cash). No phone, ids or salaries.
 */
let owner: string, ownerB: string, ahmed: string, nobody: string, buyer: string, auditor: string;
let org: string, orgB: string;

const names = (userId: string, o: string) => as({ userId }, (q) => q<Record<string, unknown>>("select * from public.staff_employee_names($1)", [o]));

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000951");
  ownerB = await createUser("966500000952");
  ahmed = await createUser("966537087951", "احمد الحساب");
  nobody = await createUser("966500000953");
  buyer = await createUser("966500000954");
  auditor = await createUser("966500000955");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, ahmed]);
    // a viewer without projects.view / purchases.view
    await q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":[],"deny":["projects.view","purchases.view","schedule.view"]}')`, [org, nobody]);
    // purchases.view only
    await q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":["purchases.view"],"deny":["projects.view"]}')`, [org, buyer]);
    // audit.view only (the audit log names its actors)
    await q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":["audit.view"],"deny":["projects.view","purchases.view","schedule.view"]}')`, [org, auditor]);
    const emp = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, job_title, phone, basic_salary, id_number) values ($1,'احمد سالم','مشرف','966537087951',4000,'2123456789') returning id", [org])).rows[0].id;
    // not linked → never listed
    await q("insert into public.employees (organization_id, full_name, job_title, phone) values ($1,'غير مرتبط','دهان','966537000099')", [org]);
    await q("select public.link_member_employee($1, $2)", [emp, ahmed]);
  });
});
afterAll(closePool);

describe("staff_employee_names", () => {
  it("gives name and job of linked employees only, no sensitive column", async () => {
    const r = await names(owner, org);
    expect(r.rows).toEqual([{ user_id: ahmed, full_name: "احمد سالم", job_title: "مشرف" }]);
  });

  it("purchases.view alone is enough (petty cash)", async () => {
    expect((await names(buyer, org)).rows.map((x) => x.full_name)).toEqual(["احمد سالم"]);
  });

  it("audit.view alone is enough (audit log), still the three columns only", async () => {
    expect((await names(auditor, org)).rows).toEqual([{ user_id: ahmed, full_name: "احمد سالم", job_title: "مشرف" }]);
  });

  it("without projects.view / purchases.view / audit.view nothing comes back", async () => {
    expect((await names(nobody, org)).rowCount).toBe(0);
  });

  it("another organization sees nothing", async () => {
    expect((await names(ownerB, org)).rowCount).toBe(0);
    expect((await names(owner, orgB)).rowCount).toBe(0);
  });

  it("an employee whose account is no longer a member of the organization isn't listed", async () => {
    await as(
      { userId: owner },
      async (q) => {
        await q("delete from public.memberships where organization_id = $1 and user_id = $2", [org, ahmed]);
        expect((await q("select * from public.staff_employee_names($1)", [org])).rowCount).toBe(0);
      },
      { rollback: true },
    );
  });
});
