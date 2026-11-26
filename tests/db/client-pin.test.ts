import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/** Maps (owner, Nov 2026): clients.latitude/longitude — a pair, in range, written under the clients RLS. */
let owner: string, viewer: string, org: string, client: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500009401");
  viewer = await createUser("966500009402");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
  await as({ userId: owner }, (q) => q("insert into public.memberships (organization_id, user_id, role) values ($1,$2,'viewer')", [org, viewer]));
  client = await as({ userId: owner }, async (q) => (await q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'عميل','966511110002') returning id", [org])).rows[0].id);
});
afterAll(closePool);

const pin = () => asAdmin((q) => q<{ latitude: string | null; longitude: string | null }>("select latitude, longitude from public.clients where id = $1", [client])).then((r) => r.rows[0]);

describe("clients site pin", () => {
  it("is saved as a pair, rounded to 6 decimals", async () => {
    await as({ userId: owner }, (q) => q("update public.clients set latitude = 24.80312345, longitude = 46.61055 where id = $1", [client]));
    expect(await pin()).toEqual({ latitude: "24.803123", longitude: "46.610550" });
  });
  it("refuses half a pin and out-of-range values", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.clients set latitude = null where id = $1", [client])), /clients_pin_pair/);
    await expectDenied(as({ userId: owner }, (q) => q("update public.clients set latitude = 91 where id = $1", [client])), /check constraint/);
  });
  it("a member without clients.manage can't move it", async () => {
    await as({ userId: viewer }, (q) => q("update public.clients set latitude = 1, longitude = 1 where id = $1", [client]));
    expect((await pin()).latitude).toBe("24.803123");
  });
});
