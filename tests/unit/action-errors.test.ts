import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Forms show errors through useActionRunner, which knows "rateLimited" (errors.rateLimited) —
// an unknown code like "limited" shows the generic «حدث خطأ».
describe("rate-limited server actions use the code the forms understand", () => {
  it("Qoyod settings actions return rateLimited", () => {
    const src = readFileSync("src/app/(app)/settings/qoyod/actions.ts", "utf8");
    expect(src).not.toMatch(/error: "limited"/);
    expect(src).toMatch(/error: "rateLimited"/);
  });
});
