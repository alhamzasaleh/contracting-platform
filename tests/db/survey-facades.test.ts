import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, closePool, createUser, expectDenied, resetDatabase } from "./db";

/** Exterior paint from the elevations (owner, Nov 2026): the reviewed façades are kept on the survey. */
let owner: string, viewer: string, org: string, survey: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009701");
  viewer = await createUser("966500009702");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, async (q) => {
    await q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]);
    const client = (await q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'عميل') returning id", [org])).rows[0].id;
    survey = (await q<{ id: string }>("insert into public.surveys (organization_id, client_id, mode) values ($1,$2,'rooms') returning id", [org, client])).rows[0].id;
  });
});
afterAll(closePool);

describe("survey façades", () => {
  it("stores the reviewed list (an array, bounded size) with clients.manage", async () => {
    const facades = [{ code: "E01", name: "الواجهة الشرقية", include: true, parts: [], openings: [], notes: [] }];
    await as({ userId: owner }, (q) => q("update public.surveys set facades = $2::jsonb where id = $1", [survey, JSON.stringify(facades)]));
    const r = await as({ userId: owner }, (q) => q<{ facades: unknown[] }>("select facades from public.surveys where id = $1", [survey]));
    expect(r.rows[0].facades).toHaveLength(1);
  });
  it("refuses anything but a list, and huge payloads", async () => {
    await expectDenied(as({ userId: owner }, (q) => q(`update public.surveys set facades = '{"a":1}'::jsonb where id = $1`, [survey])), /surveys_facades_check|check constraint/);
    const big = JSON.stringify([{ notes: ["x".repeat(70000)] }]);
    await expectDenied(as({ userId: owner }, (q) => q("update public.surveys set facades = $2::jsonb where id = $1", [survey, big])), /check constraint/);
  });
  it("a viewer can't change them", async () => {
    await as({ userId: viewer }, (q) => q("update public.surveys set facades = '[]'::jsonb where id = $1", [survey]));
    const r = await as({ userId: owner }, (q) => q<{ facades: unknown[] }>("select facades from public.surveys where id = $1", [survey]));
    expect(r.rows[0].facades).toHaveLength(1);
  });
});
