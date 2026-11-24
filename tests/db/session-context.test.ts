import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/**
 * public.session_context(): the whole session in one round trip. It is SECURITY INVOKER, so it
 * must return exactly what the separate queries returned (profile, active memberships, the
 * current organization through RLS, my_permissions) — never more.
 */
let owner: string;
let sup: string;
let outsider: string;
let org: string;

type Ctx = {
  profile: { id: string; full_name: string | null } | null;
  memberships: { organization_id: string; role: string }[];
  organization_id: string | null;
  organization: { id: string; name: string } | null;
  permissions: string[];
} | null;

const ctx = (userId: string) => as({ userId }, async (q) => (await q<{ c: Ctx }>("select public.session_context() as c")).rows[0].c);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000901", "Owner");
  sup = await createUser("966500000902", "Supervisor");
  outsider = await createUser("966500000903", "Outsider");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Ctx Co') as id")).rows[0].id);
  await asAdmin(async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role, permission_overrides) values ($1,$2,'supervisor','{\"grant\":[],\"deny\":[\"clients.manage\"]}')", [org, sup]);
  });
});
afterAll(closePool);

describe("session_context", () => {
  it("returns the owner's profile, membership, organization and the same permissions as my_permissions", async () => {
    const c = await ctx(owner);
    const perms = await as({ userId: owner }, async (q) => (await q<{ p: string[] }>("select public.my_permissions($1) as p", [org])).rows[0].p);
    expect(c?.profile?.id).toBe(owner);
    expect(c?.memberships).toEqual([{ organization_id: org, role: "owner" }]);
    expect(c?.organization_id).toBe(org);
    expect(c?.organization?.id).toBe(org);
    expect(c?.organization?.name).toBe("Ctx Co");
    expect(c?.permissions).toEqual(perms);
    expect(c?.permissions.length).toBeGreaterThan(5);
  });

  it("applies the member's own permission overrides (same as my_permissions)", async () => {
    const c = await ctx(sup);
    const perms = await as({ userId: sup }, async (q) => (await q<{ p: string[] }>("select public.my_permissions($1) as p", [org])).rows[0].p);
    expect(c?.memberships).toEqual([{ organization_id: org, role: "supervisor" }]);
    expect(c?.permissions).toEqual(perms);
    expect(c?.permissions).not.toContain("clients.manage");
    expect(c?.permissions).not.toContain("members.manage");
  });

  it("a suspended membership counts as none", async () => {
    await asAdmin((q) => q("update public.memberships set status = 'suspended' where organization_id = $1 and user_id = $2", [org, sup]));
    const c = await ctx(sup);
    expect(c?.memberships).toEqual([]);
    expect(c?.organization).toBeNull();
    expect(c?.permissions).toEqual([]);
    await asAdmin((q) => q("update public.memberships set status = 'active' where organization_id = $1 and user_id = $2", [org, sup]));
  });

  it("a signed-in user outside the organization sees no organization and no permissions", async () => {
    // even with the organization set as his default, RLS hides it
    await asAdmin((q) => q("update public.profiles set default_organization_id = $1 where id = $2", [org, outsider]));
    const c = await ctx(outsider);
    expect(c?.profile?.id).toBe(outsider);
    expect(c?.memberships).toEqual([]);
    expect(c?.organization_id).toBeNull();
    expect(c?.organization).toBeNull();
    expect(c?.permissions).toEqual([]);
  });

  it("is not callable anonymously", async () => {
    await expectDenied(as("anon", (q) => q("select public.session_context()")), /permission denied/);
  });

  it("runs as the caller (security invoker)", async () => {
    const r = await asAdmin((q) => q<{ d: boolean }>("select prosecdef as d from pg_proc where proname = 'session_context'"));
    expect(r.rows[0].d).toBe(false);
  });
});
