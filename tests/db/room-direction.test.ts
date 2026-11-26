import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/** Framing plan (owner, Nov 2026): survey_rooms.c_along — null = automatic, else length / width; written under RLS like the rest of the room. */
let owner: string, viewer: string, org: string, room: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009301");
  viewer = await createUser("966500009302");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, (q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]));
  room = await as({ userId: owner }, async (q) => {
    const c = (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'عميل','966511110001') returning id", [org])).rows[0].id;
    const s = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode) values ($1,$2,'rooms') returning id", [org, c])).rows[0].id;
    return (await q<{ id: string }>("insert into public.survey_rooms (organization_id, survey_id, name, length_m, width_m, height_m) values ($1,$2,'المجلس',6,3,3) returning id", [org, s])).rows[0].id;
  });
});
afterAll(closePool);

describe("survey_rooms.c_along", () => {
  it("starts automatic (null), takes length / width, and refuses anything else", async () => {
    const read = () => asAdmin((q) => q<{ c_along: string | null }>("select c_along from public.survey_rooms where id = $1", [room])).then((r) => r.rows[0].c_along);
    expect(await read()).toBeNull();
    await as({ userId: owner }, (q) => q("update public.survey_rooms set c_along = 'width' where id = $1", [room]));
    expect(await read()).toBe("width");
    await expectDenied(as({ userId: owner }, (q) => q("update public.survey_rooms set c_along = 'diagonal' where id = $1", [room])), /check constraint/);
    await as({ userId: owner }, (q) => q("update public.survey_rooms set c_along = null where id = $1", [room]));
    expect(await read()).toBeNull();
  });
  it("a member without clients.manage can't change it", async () => {
    await as({ userId: viewer }, (q) => q("update public.survey_rooms set c_along = 'length' where id = $1", [room]));
    const r = await asAdmin((q) => q<{ c_along: string | null }>("select c_along from public.survey_rooms where id = $1", [room]));
    expect(r.rows[0].c_along).toBeNull();
  });
});
