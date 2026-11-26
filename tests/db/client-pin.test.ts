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

/**
 * A short WhatsApp link (maps.app.goo.gl) can only be read on the server: until it is, the client is
 * «pin_pending» and the server reads it (page load / daily job). A pin set, or no link, is never pending.
 */
describe("client pin waiting for its link to be read", () => {
  const pending = () => asAdmin((q) => q<{ pin_pending: boolean }>("select pin_pending from public.clients where id = $1", [client])).then((r) => r.rows[0].pin_pending);
  it("is off by default, and never with a pin or without a link", async () => {
    expect(await pending()).toBe(false);
    await as({ userId: owner }, (q) => q("update public.clients set location_url = 'https://maps.app.goo.gl/AbC', pin_pending = true where id = $1", [client]));
    // the client still has a pin from the tests above → not pending
    expect(await pending()).toBe(false);
    await as({ userId: owner }, (q) => q("update public.clients set latitude = null, longitude = null, pin_pending = true where id = $1", [client]));
    expect(await pending()).toBe(true);
    await as({ userId: owner }, (q) => q("update public.clients set location_url = null where id = $1", [client]));
    expect(await pending()).toBe(false);
  });
  it("a new link starts its tries again", async () => {
    await as({ userId: owner }, (q) => q("update public.clients set latitude = null, longitude = null, location_url = 'https://maps.app.goo.gl/X', pin_pending = true where id = $1", [client]));
    await asAdmin((q) => q("update public.clients set pin_tries = 3, pin_tried_at = now() where id = $1", [client]));
    await as({ userId: owner }, (q) => q("update public.clients set location_url = 'https://maps.app.goo.gl/Y' where id = $1", [client]));
    const r = (await asAdmin((q) => q<{ pin_tries: number; pin_tried_at: string | null }>("select pin_tries, pin_tried_at from public.clients where id = $1", [client]))).rows[0];
    expect(r).toEqual({ pin_tries: 0, pin_tried_at: null });
  });
  it("setting the pin clears it", async () => {
    await as({ userId: owner }, (q) => q("update public.clients set location_url = 'https://maps.app.goo.gl/AbC', pin_pending = true where id = $1", [client]));
    expect(await pending()).toBe(true);
    await asAdmin((q) => q("update public.clients set latitude = 24.7, longitude = 46.7 where id = $1", [client]));
    expect(await pending()).toBe(false);
  });
});
