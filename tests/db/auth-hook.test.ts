import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

// Supabase calls this before creating any auth user (Authentication → Hooks).
const hook = (phone: string | null, email: string | null = null) =>
  asAdmin((q) => q<{ r: { error?: { http_code: number } } }>("select public.hook_before_user_created($1::jsonb) as r", [JSON.stringify({ user: { phone, email } })]));

beforeAll(async () => {
  await resetDatabase();
  const owner = await createUser("966500000801");
  await as({ userId: owner }, (q) => q("select public.create_organization('Org A')"));
  await as({ userId: owner }, async (q) => {
    const org = (await q<{ id: string }>("select id from public.organizations limit 1")).rows[0].id;
    await q("insert into public.member_invitations (organization_id, phone, role) values ($1,'966500000802','viewer')", [org]);
  });
});
afterAll(closePool);

describe("before-user-created hook", () => {
  it("allows invited and existing phones", async () => {
    expect((await hook("966500000802")).rows[0].r).toEqual({});
    expect((await hook("+966500000801")).rows[0].r).toEqual({});
  });
  it("refuses unknown phones and email sign-ups", async () => {
    expect((await hook("966500000899")).rows[0].r.error?.http_code).toBe(403);
    expect((await hook(null, "x@example.com")).rows[0].r.error?.http_code).toBe(403);
  });
  it("can't be called by app users", async () => {
    await expectDenied(as("anon", (q) => q("select public.hook_before_user_created('{}'::jsonb)")));
    await expectDenied(as({ userId: (await createUser("966500000803")) }, (q) => q("select public.hook_before_user_created('{}'::jsonb)")));
  });
});
