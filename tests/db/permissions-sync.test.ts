import { afterAll, beforeAll, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "@/lib/auth/permissions";
import { asAdmin, closePool, resetDatabase } from "./db";

beforeAll(resetDatabase);
afterAll(closePool);

it("keeps TypeScript permissions in sync with the database", async () => {
  const all = await asAdmin((q) => q<{ p: string[] }>("select private.all_permissions() as p"));
  expect([...all.rows[0].p].sort()).toEqual([...PERMISSIONS].sort());
  for (const role of ROLES) {
    const r = await asAdmin((q) => q<{ p: string[] }>("select private.role_permissions($1) as p", [role]));
    expect([...r.rows[0].p].sort(), role).toEqual([...ROLE_PERMISSIONS[role]].sort());
  }
});
