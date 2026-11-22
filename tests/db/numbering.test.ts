import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, getPool, resetDatabase } from "./db";

let org: string;
let owner: string;
const year = Number(
  new Intl.DateTimeFormat("en-u-nu-latn", { year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date()),
);

beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500000101");
  org = await as({ userId: owner }, async (q) =>
    (await q<{ id: string }>("select public.create_organization('Numbering Co') as id")).rows[0].id,
  );
});
afterAll(closePool);

const next = (type: string) =>
  asAdmin(async (q) =>
    (await q<{ n: string }>("select private.next_document_number($1, $2) as n", [org, type])).rows[0].n,
  );

describe("document numbering", () => {
  it("formats numbers per type and year", async () => {
    expect(await next("quote")).toBe(`Q-${year}-001`);
    expect(await next("quote")).toBe(`Q-${year}-002`);
    expect(await next("contract")).toBe(`C-${year}-001`);
    expect(await next("project")).toBe(`P-${year}-001`);
    expect(await next("purchase")).toBe(`PO-${year}-001`);
    expect(await next("invoice")).toBe(`INV-${year}-001`);
  });

  it("rejects unknown document types", async () => {
    await expectDenied(next("banana"), /unknown document type/);
  });

  it("leaves no gap when a transaction rolls back", async () => {
    const client = await getPool().connect();
    await client.query("begin");
    await client.query("select private.next_document_number($1, 'request')", [org]);
    await client.query("rollback");
    client.release();
    expect(await next("request")).toBe(`R-${year}-001`);
  });

  it("hands out unique, contiguous numbers under concurrency", async () => {
    const N = 25;
    const results = await Promise.all(Array.from({ length: N }, () => next("client")));
    const nums = results.map((r) => Number(r.split("-")[2])).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it("is not callable directly by signed-in users", async () => {
    await expectDenied(
      as({ userId: owner }, (q) => q("select private.next_document_number($1, 'quote')", [org])),
      /permission denied/,
    );
  });

  it("is invisible to users via the sequences table", async () => {
    await expectDenied(
      as({ userId: owner }, (q) => q("select * from public.document_sequences")),
      /permission denied/,
    );
  });
});
