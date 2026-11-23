import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, ownerB: string, org: string, orgB: string, service: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500007001");
  ownerB = await createUser("966500007002");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = true"));
  orgB = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("select public.create_organization('Org B') as id")).rows[0].id);
  await asAdmin((q) => q("update private.platform_settings set allow_self_signup = false"));
  service = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.services (organization_id, code, name_ar) values ($1,'exterior-paint','دهانات خارجية') returning id", [org])).rows[0].id);
});
afterAll(closePool);

describe("one subcontractor in three places", () => {
  it("an external labour rate creates (or reuses) the subcontractor and its external team", async () => {
    await as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, service_id, name, basis, rate) values ($1,$2,'سفيان','external_per_unit',6)", [org, service]));
    const sub = await asAdmin((q) => q<{ id: string; services: string[] }>("select id, services from public.subcontractors where organization_id = $1 and name = 'سفيان'", [org]));
    expect(sub.rows).toHaveLength(1);
    expect(sub.rows[0].services).toEqual(["exterior"]);
    const team = await asAdmin((q) => q<{ kind: string; services: string[] }>("select kind, services from public.teams where subcontractor_id = $1", [sub.rows[0].id]));
    expect(team.rows).toEqual([{ kind: "external", services: ["exterior"] }]);
    // a second rate for the same contractor reuses him
    await as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, name, basis, rate) values ($1,'سفيان','external_lump',3000)", [org]));
    expect((await asAdmin((q) => q("select id from public.subcontractors where organization_id = $1", [org]))).rows).toHaveLength(1);
    expect((await asAdmin((q) => q("select id from public.labour_rates where subcontractor_id = $1", [sub.rows[0].id]))).rows).toHaveLength(2);
  });

  it("a subcontractor added in Purchases gets his team; renaming or deactivating follows", async () => {
    const id = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.subcontractors (organization_id, name, services, phone) values ($1,'مؤسسة الجبس','{gypsum}','966500000009') returning id", [org])).rows[0].id);
    await as({ userId: owner }, (q) => q("update public.subcontractors set name = 'مؤسسة الجبس الحديثة', is_active = false where id = $1", [id]));
    const team = await asAdmin((q) => q<{ name: string; is_active: boolean; contact_phone: string }>("select name, is_active, contact_phone from public.teams where subcontractor_id = $1", [id]));
    expect(team.rows).toEqual([{ name: "مؤسسة الجبس الحديثة", is_active: false, contact_phone: "966500000009" }]);
  });

  it("links never cross organizations", async () => {
    const other = await as({ userId: ownerB }, async (q) => (await q<{ id: string }>("insert into public.subcontractors (organization_id, name) values ($1,'غريب') returning id", [orgB])).rows[0].id);
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.labour_rates (organization_id, name, basis, rate, subcontractor_id) values ($1,'x','external_lump',1,$2)", [org, other])));
    await expectDenied(as({ userId: owner }, (q) => q("update public.teams set subcontractor_id = $1 where organization_id = $2", [other, org])));
  });
});
