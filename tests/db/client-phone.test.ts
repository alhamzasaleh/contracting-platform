import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

/*
 * The client's phone is required (owner, Nov 2026: «رقم جوال العميل ضروري») — WhatsApp messages,
 * the client page link and the contract's second party all use it.
 */
let owner: string, org: string;

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000961");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org C') as id")).rows[0].id);
});
afterAll(closePool);

describe("client phone required", () => {
  it("a new client without a phone is refused; with one it's saved", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("insert into public.clients (organization_id, name) values ($1,'بدون جوال')", [org])), /client phone required/);
    const r = await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'مع جوال','966537000211') returning id", [org]));
    expect(r.rows).toHaveLength(1);
  });
  it("a client's phone can't be emptied; other edits still work", async () => {
    const id = (await as({ userId: owner }, (q) => q<{ id: string }>("insert into public.clients (organization_id, name, phone) values ($1,'سالم','966537000212') returning id", [org]))).rows[0].id;
    await expectDenied(as({ userId: owner }, (q) => q("update public.clients set phone = null where id = $1", [id])), /client phone required/);
    await as({ userId: owner }, (q) => q("update public.clients set city = 'الرياض' where id = $1", [id]));
    const row = await asAdmin((q) => q<{ city: string; phone: string }>("select city, phone from public.clients where id = $1", [id]));
    expect(row.rows[0]).toEqual({ city: "الرياض", phone: "966537000212" });
  });
});

describe("older rows", () => {
  it("a client saved before the phone became required can still be edited in other ways", async () => {
    const id = (await asAdmin((q) => q<{ id: string }>("insert into public.clients (organization_id, name) values ($1,'قديم') returning id", [org]))).rows[0].id;
    await as({ userId: owner }, (q) => q("update public.clients set city = 'جدة' where id = $1", [id]));
  });
});
