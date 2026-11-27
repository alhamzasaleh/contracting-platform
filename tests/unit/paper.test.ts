import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { paperScale, PAPER_WIDTH } from "@/lib/paper";

describe("the paper scales as a whole to the screen (owner, Nov 2026)", () => {
  it("fits the container, never grows past its own size", () => {
    expect(paperScale(380, PAPER_WIDTH)).toBeCloseTo(380 / PAPER_WIDTH, 5);
    expect(paperScale(2000, PAPER_WIDTH)).toBe(1);
    expect(paperScale(PAPER_WIDTH, PAPER_WIDTH)).toBe(1);
  });
  it("an unmeasured container keeps the natural size", () => {
    expect(paperScale(0, PAPER_WIDTH)).toBe(1);
    expect(paperScale(Number.NaN, PAPER_WIDTH)).toBe(1);
  });

  // every document keeps one layout: no screen breakpoints inside it (the sheet is always
  // its own width; only print:… variants may change it). Documents are found by themselves:
  // a white <article> in basalt ink — the paper look — anywhere under src/components.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = path.join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : f.endsWith(".tsx") ? [f] : [];
    });
  const DOCS = walk("src/components").filter((f) => {
    const src = readFileSync(f, "utf8");
    return /<article\b[^>]*\bbg-white\b/.test(src) || /const ARTICLE = "[^"]*\bbg-white\b/.test(src);
  });
  it("finds the documents (the list isn't hand-written)", () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(11);
    expect(DOCS).toContain(path.join("src/components/team/payslips.tsx"));
  });
  it("the measurement sheet the client signs on his page is on a sheet too", () => {
    expect(readFileSync("src/components/portal/measurements.tsx", "utf8")).toMatch(/<Paper[^>]*>\s*<MeasurementTable/);
  });
  it.each(DOCS)("%s sits on a Paper and has no screen breakpoints", (f) => {
    const src = readFileSync(f, "utf8");
    expect(src).toMatch(/<Paper\b/);
    expect(src.match(/\b(?:sm|md|lg|xl|2xl|max-sm|max-md|min-\[\d+px\]|max-\[\d+px\]):[\w[\]-]/g) ?? []).toEqual([]);
    // sizes tied to the viewport (vw) would shrink twice inside a scaled sheet
    expect(src.match(/\d+vw/g) ?? []).toEqual([]);
  });
});
