import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The database is in Supabase eu-west-1 (Ireland). Every page runs several queries, so the
// server must sit next to it (Vercel dub1 = Dublin); far away, each query crosses an ocean.
describe("the server runs next to the database", () => {
  it("vercel.json pins functions to Dublin (dub1)", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { regions?: string[] };
    expect(cfg.regions).toEqual(["dub1"]);
  });
});
