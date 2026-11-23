import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, asAdmin, closePool, createUser, expectDenied, resetDatabase } from "./db";

let owner: string, org: string;
beforeAll(async () => {
  await resetDatabase();
  owner = await createUser("966500001901");
  org = await as({ userId: owner }, async (q) => (await q<{ id: string }>("select public.create_organization('Org A') as id")).rows[0].id);
});
afterAll(closePool);

describe("logo SVG", () => {
  it("accepts a plain SVG drawing, refuses scripts and links", async () => {
    await asAdmin((q) => q("update public.organizations set logo_svg = '<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h1v1z\"/></svg>' where id = $1", [org]));
    await expectDenied(asAdmin((q) => q("update public.organizations set logo_svg = '<svg><script>alert(1)</script></svg>' where id = $1", [org])));
    await expectDenied(asAdmin((q) => q("update public.organizations set logo_svg = '<svg onload=\"x()\"></svg>' where id = $1", [org])));
    await expectDenied(asAdmin((q) => q("update public.organizations set logo_compact_svg = '<svg><a href=\"javascript:x\"/></svg>' where id = $1", [org])));
  });

  it("users can't write it directly; uploading a new logo replaces it", async () => {
    await expectDenied(as({ userId: owner }, (q) => q("update public.organizations set logo_svg = '<svg></svg>' where id = $1", [org])));
    await as({ userId: owner }, (q) => q("update public.organizations set logo_path = $1 where id = $2", [`${org}/logo-new.png`, org]));
    const r = await asAdmin((q) => q<{ logo_svg: string | null }>("select logo_svg from public.organizations where id = $1", [org]));
    expect(r.rows[0].logo_svg).toBeNull();
  });
});
