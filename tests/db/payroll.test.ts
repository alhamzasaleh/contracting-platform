import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, supervisor: string, ownerB: string;
let org: string, emp1: string, run: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001301");
  supervisor = await createUser("966500001302");
  ownerB = await createUser("966500001303");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  await as({ userId: ownerB }, (q) => q("select public.create_organization('Org B')"));
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, supervisor]);
    emp1 = (await q<{ id: string }>("insert into public.employees (organization_id, phone, full_name, basic_salary, housing_allowance, transport_allowance, iban) values ($1,'966500009999','أحمد',3000,750,300,'SA0380000000608010167519') returning id", [org])).rows[0].id;
    await q("insert into public.employees (organization_id, phone, full_name, basic_salary, status) values ($1,'966500009999','سالم',2500,'final_exit')", [org]);
    await q("insert into public.employee_advances (organization_id, employee_id, amount) values ($1,$2,500)", [org, emp1]);
  });
});
afterAll(closePool);

describe("payroll", () => {
  it("a month takes each active employee's salary and open advances", async () => {
    run = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_payroll_run($1, '2026-11-15') as id", [org])).rows[0].id);
    const lines = await as({ userId: owner }, (q) => q<{ full_name: string; net: string; advances: string }>("select full_name, net, advances from public.payroll_lines where run_id = $1", [run]));
    expect(lines.rows).toHaveLength(1);
    expect(Number(lines.rows[0].advances)).toBe(500);
    expect(Number(lines.rows[0].net)).toBe(3550);
    // same month again returns the same run
    const again = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_payroll_run($1, '2026-11-01') as id", [org])).rows[0].id);
    expect(again).toBe(run);
  });

  it("net is computed by the database; salary parts can't be edited on the line", async () => {
    const r = await as({ userId: owner }, (q) => q<{ net: string }>("update public.payroll_lines set overtime = 200, deductions = 50, net = 999999 where run_id = $1 returning net", [run]));
    expect(Number(r.rows[0].net)).toBe(3700);
    await expectDenied(as({ userId: owner }, (q) => q("update public.payroll_lines set basic = 9000 where run_id = $1", [run])), /employee record/);
  });

  it("approval locks the month and settles advances; then it can be marked paid", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.payroll_runs set status = 'approved' where id = $1", [run])), /payroll functions/);
    await as({ userId: owner }, (q) => q("select public.approve_payroll_run($1)", [run]));
    await expectDenied(as({ userId: owner }, (q) => q("update public.payroll_lines set overtime = 1 where run_id = $1", [run])), /can't change/);
    const adv = await as({ userId: owner }, (q) => q<{ n: number }>("select count(*)::int as n from public.employee_advances where deducted_in_run is null"));
    expect(adv.rows[0].n).toBe(0);
    await as({ userId: owner }, (q) => q("select public.mark_payroll_paid($1, current_date)", [run]));
  });

  it("salaries are private: supervisors and other organizations see nothing", async () => {
    const s = await as({ userId: supervisor }, (q) => q("select (select count(*)::int from public.payroll_lines) + (select count(*)::int from public.employee_advances) as n"));
    expect(s.rows[0].n).toBe(0);
    await expectDenied(as({ userId: supervisor }, (q) => q("select public.create_payroll_run($1, '2026-12-01')", [org])), /not allowed/);
    const b = await as({ userId: ownerB }, (q) => q("select count(*)::int as n from public.payroll_runs"));
    expect(b.rows[0].n).toBe(0);
  });
});
