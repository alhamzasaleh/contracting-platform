import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/*
 * Employee ↔ sign-in account (owner, Nov 2026: «زر في ملف الموظف»).
 * An invitation may carry employee_id; when the invited phone signs in, accept_pending_invitations()
 * links that employee to the new account (employees.user_id) in the same transaction. Users never
 * write user_id themselves.
 */
let owner: string, ownerB: string, viewer: string, inviter: string, ahmed: string;
let org: string, orgB: string, emp: string, emp2: string, empB: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000901");
  ownerB = await createUser("966500000902");
  viewer = await createUser("966500000903");
  inviter = await createUser("966500000904"); // members.manage without hr.view
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    await q(`insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'viewer','{"grant":["members.manage"],"deny":[]}')`, [org, inviter]);
    emp = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, job_title, phone, basic_salary) values ($1,'احمد','مشرف','966537087857',4000) returning id", [org])).rows[0].id;
    emp2 = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, job_title, phone) values ($1,'سالم','دهان','966537000002') returning id", [org])).rows[0].id;
  });
  empB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("insert into public.employees (organization_id, full_name) values ($1,'موظف ب') returning id", [orgB])).rows[0].id);
});
afterAll(closePool);

describe("employee ↔ account", () => {
  it("users can't write employees.user_id, on insert or update", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.employees set user_id = $2 where id = $1", [emp, viewer])), /set by the database/);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.employees (organization_id, full_name, user_id) values ($1,'xx yy',$2)", [org, viewer])), /set by the database/);
  });

  it("an invitation can't point at another organization's employee, nor be made without members.manage", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537111111','viewer',$2)", [org, empB])), /another organization/);
    await expectDenied(as({ userId: viewer }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537111111','viewer',$2)", [org, emp])));
  });

  it("members.manage without hr.view can invite an employee, but still can't read hr data", async () => {
    await as(
      { userId: inviter },
      async (q) => {
        await q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537000002','viewer',$2)", [org, emp2]);
        const hr = await q("select basic_salary from public.employees");
        expect(hr.rowCount).toBe(0);
        const links = await q<Record<string, unknown>>("select * from public.member_employee_links($1)", [org]);
        expect(links.rows.map((r) => r.full_name).sort()).toEqual(["احمد", "سالم"]);
        expect(Object.keys(links.rows[0]).sort()).toEqual(["employee_id", "full_name", "job_title", "phone", "status", "user_id"]);
      },
      { rollback: true },
    );
    // no members.manage → nothing
    await expectDenied(as({ userId: viewer }, (q) => q("select * from public.member_employee_links($1)", [org])));
    expect((await as({ userId: ownerB }, (q) => q("select * from public.member_employee_links($1)", [org]).catch(() => ({ rowCount: 0 })))).rowCount).toBe(0);
  });

  it("accepting the invitation links the employee to the new account", async () => {
    await as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, full_name, role, employee_id) values ($1,'966537087857','احمد','supervisor',$2)", [org, emp]));
    ahmed = await createUser("966537087857");
    const n = await as({ userId: ahmed }, async (q) => (await q<{ n: number }>("select public.accept_pending_invitations() as n")).rows[0].n);
    expect(n).toBe(1);
    const row = await asAdmin((q) => q<{ user_id: string }>("select user_id from public.employees where id = $1", [emp]));
    expect(row.rows[0].user_id).toBe(ahmed);
    const m = await asAdmin((q) => q<{ role: string }>("select role from public.memberships where organization_id = $1 and user_id = $2", [org, ahmed]));
    expect(m.rows[0].role).toBe("supervisor");
  });

  it("inviting an employee who already has access is refused clearly", async () => {
    await expectDenied(
      as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537222222','viewer',$2)", [org, emp])),
      /employee already has access/,
    );
  });

  it("accepting never fails sign-in when that account already has an employee in the organization", async () => {
    const u = await createUser("966537000002");
    const emp3 = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.employees (organization_id, full_name) values ($1,'ثالث') returning id", [org])).rows[0].id);
    await as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537000002','viewer',$2)", [org, emp2]));
    await asAdmin((q) => q("update public.employees set user_id = $2 where id = $1", [emp3, u])); // already linked elsewhere
    expect((await as({ userId: u }, (q) => q<{ n: number }>("select public.accept_pending_invitations() as n"))).rows[0].n).toBe(1);
    const linked = await asAdmin((q) => q<{ id: string }>("select id from public.employees where user_id = $1", [u]));
    expect(linked.rows.map((r) => r.id)).toEqual([emp3]);
  });
});

/* Review round: wrong person, expired invitations, existing members, unlink, phone changes. */
describe("employee ↔ account: review", () => {
  let org2: string, owner2: string, worker: string, empW: string, empX: string, member2: string;

  beforeAll(async () => {
    owner2 = await createUser("966500000911");
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
    org2 = await as({ userId: owner2 }, async (q) => (await q<{ id: string }>("select public.create_organization('Org C') as id")).rows[0].id);
    await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
    member2 = await createUser("966537444444"); // an existing member who is also an employee
    worker = await createUser("966537555555");
    await as({ userId: owner2 }, async (q) => {
      await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org2, member2]);
      empW = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, phone) values ($1,'وليد','966537555555') returning id", [org2])).rows[0].id;
      empX = (await q<{ id: string }>("insert into public.employees (organization_id, full_name, phone) values ($1,'خالد','966537444444') returning id", [org2])).rows[0].id;
    });
  });

  it("an invitation for an employee must go to the employee's own number", async () => {
    await expectDenied(
      as({ userId: owner2 }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537999999','viewer',$2)", [org2, empW])),
      /not the employee's phone/,
    );
    // changing the number of an existing invitation is checked too
    await as(
      { userId: owner2 },
      async (q) => {
        const id = (await q<{ id: string }>("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537555555','viewer',$2) returning id", [org2, empW])).rows[0].id;
        await expectDenied(q("update public.member_invitations set phone = '966537999999' where id = $1", [id]), /not the employee's phone/);
      },
      { rollback: true },
    );
  });

  it("an expired invitation never blocks a new one for the same number or employee", async () => {
    await as({ userId: owner2 }, async (q) => {
      await q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537555555','viewer',$2)", [org2, empW]);
    });
    await asAdmin((q) => q("update public.member_invitations set expires_at = now() - interval '1 day' where employee_id = $1", [empW]));
    await as({ userId: owner2 }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537555555','supervisor',$2)", [org2, empW]));
    const rows = await asAdmin((q) => q<{ revoked: boolean; role: string }>("select revoked_at is not null as revoked, role from public.member_invitations where employee_id = $1 order by created_at", [empW]));
    expect(rows.rows).toEqual([{ revoked: true, role: "viewer" }, { revoked: false, role: "supervisor" }]);
  });

  it("changing an employee's phone cancels his pending invitation", async () => {
    await as({ userId: owner2 }, (q) => q("update public.employees set phone = '966537555556' where id = $1", [empW]));
    const open = await asAdmin((q) => q("select 1 from public.member_invitations where employee_id = $1 and accepted_at is null and revoked_at is null", [empW]));
    expect(open.rowCount).toBe(0);
    await as({ userId: owner2 }, (q) => q("update public.employees set phone = '966537555555' where id = $1", [empW]));
  });

  it("inviting a number that is already a member is refused with a reason", async () => {
    await expectDenied(as({ userId: owner2 }, (q) => q("insert into public.member_invitations (organization_id, phone, role) values ($1,'966537444444','supervisor')", [org2])), /already a member/);
  });

  it("an existing member is linked to the employee with his number; then unlinked; then can be invited again", async () => {
    // the number must match the member's account
    await expectDenied(as({ userId: owner2 }, (q) => q("select public.link_member_employee($1,$2)", [empW, member2])), /phone/);
    // only with members.manage
    await expectDenied(as({ userId: member2 }, (q) => q("select public.link_member_employee($1,$2)", [empX, member2])), /not allowed/);
    await as({ userId: owner2 }, (q) => q("select public.link_member_employee($1,$2)", [empX, member2]));
    expect((await asAdmin((q) => q<{ user_id: string }>("select user_id from public.employees where id = $1", [empX]))).rows[0].user_id).toBe(member2);
    // a member linked to another employee can't be invited for a new one
    await expectDenied(as({ userId: owner2 }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966537444444','viewer',$2)", [org2, empX])), /already has access/);
    // unlink: members.manage only, written to the audit log
    await expectDenied(as({ userId: member2 }, (q) => q("select public.unlink_employee_account($1)", [empX])), /not allowed/);
    await as({ userId: owner2 }, (q) => q("select public.unlink_employee_account($1)", [empX]));
    expect((await asAdmin((q) => q<{ user_id: string | null }>("select user_id from public.employees where id = $1", [empX]))).rows[0].user_id).toBeNull();
    const audit = await asAdmin((q) => q("select 1 from public.audit_log where table_name = 'employees' and record_id = $1::text and actor_id = $2", [empX, owner2]));
    expect(audit.rowCount).toBeGreaterThan(0);
    // another organization's owner can't touch it
    await expectDenied(as({ userId: owner }, (q) => q("select public.unlink_employee_account($1)", [empX])), /not allowed/);
  });

  it("member_employee_links also tells the employee's status", async () => {
    const r = await as({ userId: owner2 }, (q) => q<{ full_name: string; status: string }>("select full_name, status from public.member_employee_links($1)", [org2]));
    expect(r.rows.map((x) => x.status)).toEqual(["active", "active"]);
    void worker;
  });

  it("an invitation made revoked and then un-revoked never links an employee to another number", async () => {
    const e = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.employees (organization_id, full_name, phone) values ($1,'هدف','966511119955') returning id", [org])).rows[0].id);
    // the revoked-then-un-revoked trick is refused at the first step …
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id, revoked_at) values ($1,'966511119902','viewer',$2, now())", [org, e])), /starts pending/);
    // … and even a mismatched row that got in some other way (written past the checks) never links at acceptance
    const inv = await asAdmin(async (q) => {
      await q("alter table public.member_invitations disable trigger member_invitations_link");
      const id = (await q<{ id: string }>("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966511119902','viewer',$2) returning id", [org, e])).rows[0].id;
      await q("alter table public.member_invitations enable trigger member_invitations_link");
      return id;
    });
    const other = await createUser("966511119902");
    await as({ userId: other }, (q) => q("select public.accept_pending_invitations()"));
    const row = await asAdmin((q) => q<{ user_id: string | null }>("select user_id from public.employees where id = $1", [e]));
    expect(row.rows[0].user_id).toBeNull();
    expect(inv).toBeTruthy();
  });

  it("users can't create an invitation already revoked / accepted, nor un-revoke one", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, revoked_at) values ($1,'966511119911','viewer', now())", [org])));
    const id = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.member_invitations (organization_id, phone, role) values ($1,'966511119912','viewer') returning id", [org])).rows[0].id);
    await as({ userId: owner }, (q) => q("update public.member_invitations set revoked_at = now() where id = $1", [id]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.member_invitations set revoked_at = null where id = $1", [id])));
  });

  it("an employee without a phone on file can't be invited (the number must be his own)", async () => {
    const e = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.employees (organization_id, full_name) values ($1,'بلا رقم') returning id", [org])).rows[0].id);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.member_invitations (organization_id, phone, role, employee_id) values ($1,'966511119913','viewer',$2)", [org, e])), /not the employee's phone/);
  });
});
