import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/*
 * The employee's phone is required (owner, Nov 2026: «لازم رقم جواله») — it is his sign-in number
 * when he gets access to the system. The database refuses an employee without one from the app.
 */
let owner: string, org: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000951");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org P') as id")).rows[0].id);
});
afterAll(closePool);

describe("employee phone required", () => {
  it("a new employee without a phone is refused; with one it's saved", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.employees (organization_id, full_name) values ($1,'بدون جوال')", [org])), /employee phone required/);
    const r = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.employees (organization_id, full_name, phone) values ($1,'مع جوال','966537000111') returning id", [org]));
    expect(r.rows).toHaveLength(1);
  });
  it("an employee's phone can't be emptied; other edits still work", async () => {
    const id = (await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.employees (organization_id, full_name, phone) values ($1,'سالم','966537000112') returning id", [org]))).rows[0].id;
    await expectDenied(as({ userId: owner }, (q) => q("update public.employees set phone = null where id = $1", [id])), /employee phone required/);
    await as({ userId: owner }, (q) => q("update public.employees set job_title = 'دهان' where id = $1", [id]));
    const row = await asAdmin((q) => q<{ job_title: string; phone: string }>("select job_title, phone from public.employees where id = $1", [id]));
    expect(row.rows[0]).toEqual({ job_title: "دهان", phone: "966537000112" });
  });
  it("an older employee saved without a phone can still be edited in other ways (no lock-out)", async () => {
    const id = (await asAdmin((q) => q<{ id: string }>("insert into public.employees (organization_id, full_name) values ($1,'قديم') returning id", [org]))).rows[0].id;
    await as({ userId: owner }, (q) => q("update public.employees set status = 'on_leave' where id = $1", [id]));
  });
});
