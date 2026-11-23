import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, sup: string, org: string, purchase: string, run: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500006001");
  sup = await createUser("966500006002");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, (q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'supervisor')", [org, sup]));
  await asAdmin(async (q) => {
    await q("insert into public.qoyod_settings (organization_id, enabled) values ($1, true)", [org]);
    purchase = (await q<{ id: string }>("insert into public.purchases (organization_id, status, subtotal, total, recorded_at) values ($1,'recorded',1000,1150, now()) returning id", [org])).rows[0].id;
    run = (await q<{ id: string }>("insert into public.payroll_runs (organization_id, month, status) values ($1, date_trunc('month', current_date)::date, 'approved') returning id", [org])).rows[0].id;
    // two payslips (written directly for the test; the app computes them)
    await q("set local session_replication_role = replica");
    await q("insert into public.payroll_lines (organization_id, run_id, employee_id, full_name, net) values ($1,$2,gen_random_uuid(),'أ',4000.5),($1,$2,gen_random_uuid(),'ب',3500)", [org, run]);
  });
});
afterAll(closePool);

const jobs = (kind: string) => asAdmin((q) => q<{ ref: string; amount: string }>("select ref, amount from public.qoyod_sync_jobs where kind = $1", [kind])).then((r) => r.rows);

describe("Qoyod supplier payments & payroll", () => {
  it("only finance records a supplier payment, once; it queues the bill and its payment", async () => {
    await expectDenied(as({ userId: sup }, (q) => q("select public.record_purchase_payment($1, current_date, 'bank', null)", [purchase])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.purchases set paid_on = current_date where id = $1", [purchase])));
    await as({ userId: owner }, (q) => q("select public.record_purchase_payment($1, current_date, 'cash', 'TRX-1')", [purchase]));
    await expect(as({ userId: owner }, (q) => q("select public.record_purchase_payment($1, current_date, 'bank', null)", [purchase]))).rejects.toThrow(/already paid/);
    expect((await jobs("bill_payment")).map((j) => [j.ref, Number(j.amount)])).toEqual([[`pp:${purchase}`, 1150]]);
    expect((await jobs("bill")).map((j) => j.ref)).toEqual([`po:${purchase}`]);
  });

  it("a paid payroll run queues one journal entry for the net salaries", async () => {
    await asAdmin((q) => q("update public.payroll_runs set status = 'paid', paid_on = current_date where id = $1", [run]));
    const j = await jobs("payroll");
    expect(j).toHaveLength(1);
    expect(j[0].ref).toMatch(/^pr:\d{4}-\d{2}$/);
    expect(Number(j[0].amount)).toBe(7500.5);
  });

  it("the worker can defer a job without using up its tries (service role only)", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("select public.qoyod_defer_job(gen_random_uuid(), 60, 'x')")));
  });
});
