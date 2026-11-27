import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * An effect's arrow body without braces returns its expression to React as the "cleanup". A DOM
 * call like scrollIntoView / scrollTo / focus may return a value (newer Chrome: a Promise) — React
 * then calls it and the page crashes (the assistant, Nov 2026). Only a bare function name is allowed
 * (e.g. `useEffect(() => dropDoc, [])` returns a real cleanup).
 */
function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("effects return nothing or a cleanup function", () => {
  it("no effect returns the value of a call", () => {
    const bad: string[] = [];
    for (const f of files("src")) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>\s*([^\s{][^\n]*?),\s*\[[^\]\n]*\]\s*\)/g)) {
        if (!/^[A-Za-z_$][\w$]*$/.test(m[1].trim())) bad.push(`${f}: ${m[1].trim().slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
